import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisionIntents, decisions, reviewTimes, roleGrants, submissions } from "@/db/schema";
import { canonicalJson, decisionHash, ledgerKey, type DecisionRecord } from "@/ledger/canonical";
import {
  DecisionPendingError,
  DecisionRejectedError,
  type DecisionLedger,
  type DecisionTxStatus,
  type SignedDecision,
} from "@/ledger/decision-ledger";
import { decide, DECISION_IN_FLIGHT_MS, decideSchema, ENVELOPE_EXPIRY_MARGIN_MS } from "@/services/review";
import { makeTestDb } from "./db";

vi.mock("server-only", () => ({}));

const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const SPAM = { ...ALL_PASS, not_spam: false, content_original: false, follows_brief: false };
const ALICE = { pubkey: "G_ALICE" };
const BOB = { pubkey: "G_BOB" };

/** What the next submit does: land, be refused for good, lose its answer, or lose its answer after landing. */
type SubmitMode = "land" | "reject" | "pending" | "land-then-pending" | "land-then-reject";

/**
 * A network in memory. Every signature gets a new hash, like a new sequence
 * number would; `landed` is what is on chain. `gate` holds submits open.
 */
class FakeLedger implements DecisionLedger {
  readonly signed: DecisionRecord[] = [];
  readonly sent: string[] = [];
  readonly landed = new Map<string, DecisionRecord>();
  readonly failedOnChain = new Set<string>();
  private readonly envelopes = new Map<string, DecisionRecord>();
  gate: Promise<void> | null = null;
  mode: SubmitMode = "land";
  ttlMs = 60_000;

  get records(): DecisionRecord[] {
    return [...this.landed.values()];
  }

  async sign(record: DecisionRecord): Promise<SignedDecision> {
    this.signed.push(record);
    const txHash = `tx_${this.signed.length}`;
    this.envelopes.set(txHash, record);
    return { txHash, envelopeXdr: `env_${this.signed.length}`, expiresAt: new Date(Date.now() + this.ttlMs) };
  }

  async submit(s: SignedDecision): Promise<void> {
    if (this.gate) await this.gate;
    this.sent.push(s.txHash);
    const mode = this.mode;
    this.mode = "land";
    const record = this.envelopes.get(s.txHash);
    if (!record) throw new DecisionRejectedError("unknown envelope");
    if (mode === "reject") throw new DecisionRejectedError('{"transaction":"tx_bad_auth"}');
    if (mode === "pending") throw new DecisionPendingError(new Error("504 timeout"));
    this.landed.set(s.txHash, record);
    if (mode === "land-then-pending") throw new DecisionPendingError(new Error("504 timeout"));
    if (mode === "land-then-reject") throw new DecisionRejectedError('{"transaction":"tx_bad_seq"}');
  }

  async status(txHash: string): Promise<DecisionTxStatus> {
    if (this.failedOnChain.has(txHash)) return "failed";
    return this.landed.has(txHash) ? "success" : "not_found";
  }
}

let conn: Db;
let close: () => Promise<void>;
let ledger: FakeLedger;

const body = (signals = ALL_PASS, reasonCode = "R00_PASS") =>
  decideSchema.parse({ submissionId: "sub_1", signals, reasonCode, note: "Looks fine", secondsTotal: 30 });
const pass = (who = ALICE) => decide(body(), who, ledger, conn);
const intents = () => conn.select().from(decisionIntents);
const status = async () => (await conn.select().from(submissions).where(eq(submissions.id, "sub_1")))[0]?.status;
/** Makes the held intent look abandoned, as after a crash two minutes ago. */
const ageIntent = () => conn.update(decisionIntents).set({ createdAt: new Date(Date.now() - DECISION_IN_FLIGHT_MS - 1000) });

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  ledger = new FakeLedger();
  await conn.insert(campaigns).values({
    id: "cmp_1",
    slug: "camp-1",
    title: "Campaign 1",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    fundedAt: new Date(),
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  });
  await conn.insert(submissions).values({ id: "sub_1", shortId: "abc123", campaignId: "cmp_1", contributorPubkey: "G_CONTRIB", workUrl: "https://x.com/u/status/1", status: "pending" });
  await conn.insert(roleGrants).values([
    { pubkey: ALICE.pubkey, role: "reviewer" },
    { pubkey: BOB.pubkey, role: "reviewer" },
  ]);
});

afterEach(async () => {
  await close();
});

describe("one decision per submission reaches the chain", () => {
  it("stores the decision and leaves no intent behind", async () => {
    const d = await pass();
    expect(d.txHash).toBe("tx_1");
    expect(await status()).toBe("decided");
    expect(await intents()).toEqual([]);
    expect(await conn.select().from(reviewTimes)).toHaveLength(1);
  });

  it("stores the signed envelope and its hash on the intent before sending it", async () => {
    let open: () => void = () => undefined;
    ledger.gate = new Promise<void>((resolve) => (open = resolve));
    const first = pass();
    await vi.waitFor(async () => expect((await intents())[0]?.txHash).toBe("tx_1"));
    expect(ledger.sent).toEqual([]);
    expect((await intents())[0]).toMatchObject({ envelopeXdr: "env_1", envelopeExpiresAt: expect.any(Date) });
    open();
    expect((await first).txHash).toBe("tx_1");
  });

  it("refuses a second reviewer while the first commit is still running, and commits once", async () => {
    let open: () => void = () => undefined;
    ledger.gate = new Promise<void>((resolve) => (open = resolve));
    const first = pass(ALICE);
    // Wait until Alice holds the submission.
    await vi.waitFor(async () => expect(await intents()).toHaveLength(1));
    await expect(pass(BOB)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("being recorded") });
    open();
    const d = await first;
    expect(d.reviewerPubkey).toBe(ALICE.pubkey);
    expect(ledger.records).toHaveLength(1);
    expect(await conn.select().from(decisions)).toHaveLength(1);
    await expect(pass(BOB)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ledger.records).toHaveLength(1);
  });

  it("frees the submission when the network rejects the transaction for good, so the reviewer can record again", async () => {
    ledger.mode = "reject";
    await expect(pass()).rejects.toBeInstanceOf(DecisionRejectedError);
    expect(await intents()).toEqual([]);
    expect(await conn.select().from(decisions)).toEqual([]);
    expect(await status()).toBe("pending");
    expect((await pass()).txHash).toBe("tx_2");
    expect(ledger.records).toHaveLength(1);
  });

  it("frees the submission when signing fails: nothing was sent", async () => {
    vi.spyOn(ledger, "sign").mockRejectedValueOnce(new Error("could not load the decision ledger account"));
    await expect(pass()).rejects.toThrow("could not load");
    expect(await intents()).toEqual([]);
    expect(ledger.sent).toEqual([]);
  });

  it("keeps the intent when the answer is lost, and refuses a retry while it may still land", async () => {
    ledger.mode = "pending";
    await expect(pass()).rejects.toBeInstanceOf(DecisionPendingError);
    expect(await intents()).toMatchObject([{ txHash: "tx_1" }]);
    expect(await status()).toBe("pending");
    await expect(pass(BOB)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("being recorded") });
    expect(ledger.signed).toHaveLength(1);
  });

  it("an unknown submit error is treated as a lost answer, not a rejection", async () => {
    vi.spyOn(ledger, "submit").mockRejectedValueOnce(new Error("socket hang up"));
    await expect(pass()).rejects.toBeInstanceOf(DecisionPendingError);
    expect(await intents()).toHaveLength(1);
  });

  it("a resend refused as tx_bad_seq because the first send landed is recorded, not freed", async () => {
    ledger.mode = "land-then-reject";
    const d = await pass();
    expect(d.txHash).toBe("tx_1");
    expect(await intents()).toEqual([]);
    expect(ledger.records).toHaveLength(1);
  });
});

describe("resuming an intent whose answer was lost", () => {
  it("landed: stores the decision with the stored hash, without signing or sending again", async () => {
    ledger.mode = "land-then-pending";
    await expect(pass(ALICE)).rejects.toBeInstanceOf(DecisionPendingError);
    await ageIntent();
    const d = await decide(body(SPAM, "R06_SPAM"), BOB, ledger, conn);
    expect(d).toMatchObject({ txHash: "tx_1", reviewerPubkey: ALICE.pubkey, outcome: "PASS" });
    expect(ledger.signed).toHaveLength(1);
    expect(ledger.sent).toEqual(["tx_1"]);
    expect(await conn.select().from(decisions)).toHaveLength(1);
    expect(await intents()).toEqual([]);
  });

  it("not on chain and still valid: sends the same envelope again", async () => {
    ledger.mode = "pending";
    await expect(pass(ALICE)).rejects.toBeInstanceOf(DecisionPendingError);
    await ageIntent();
    const d = await pass(BOB);
    expect(d.txHash).toBe("tx_1");
    expect(ledger.signed).toHaveLength(1);
    expect(ledger.sent).toEqual(["tx_1", "tx_1"]);
  });

  it("not on chain and expired: signs a new envelope for the same record", async () => {
    ledger.mode = "pending";
    ledger.ttlMs = -ENVELOPE_EXPIRY_MARGIN_MS - 1000;
    await expect(pass(ALICE)).rejects.toBeInstanceOf(DecisionPendingError);
    await ageIntent();
    ledger.ttlMs = 60_000;
    const d = await decide(body(SPAM, "R06_SPAM"), BOB, ledger, conn);
    expect(d.txHash).toBe("tx_2");
    expect(ledger.signed).toHaveLength(2);
    // Same canonical record both times: the ledger key never carries two different records.
    expect(canonicalJson(ledger.signed[1] as DecisionRecord)).toBe(canonicalJson(ledger.signed[0] as DecisionRecord));
    expect(ledger.records).toHaveLength(1);
    expect(d.decisionHash).toBe(decisionHash(ledger.signed[0] as DecisionRecord).toString("hex"));
  });

  it("failed on chain: frees the submission", async () => {
    ledger.mode = "pending";
    await expect(pass(ALICE)).rejects.toBeInstanceOf(DecisionPendingError);
    ledger.failedOnChain.add("tx_1");
    await ageIntent();
    await expect(pass(BOB)).rejects.toBeInstanceOf(DecisionRejectedError);
    expect(await intents()).toEqual([]);
    expect(await status()).toBe("pending");
  });

  it("a retry never yields a second, different record", async () => {
    ledger.mode = "pending";
    await expect(pass(ALICE)).rejects.toBeInstanceOf(DecisionPendingError);
    const held = (await intents())[0]?.canonicalJson;
    for (let i = 0; i < 3; i++) {
      await ageIntent();
      ledger.mode = "pending";
      await expect(decide(body(SPAM, "R06_SPAM"), BOB, ledger, conn)).rejects.toBeInstanceOf(DecisionPendingError);
      expect((await intents())[0]?.canonicalJson).toBe(held);
    }
    await ageIntent();
    const d = await pass(BOB);
    expect(d.canonicalJson).toBe(held);
    expect(new Set(ledger.signed.map((r) => canonicalJson(r)))).toEqual(new Set([held]));
  });

  it("finishes a pre-envelope intent (no stored hash) with the same record, not with new input", async () => {
    // Written by the previous release: no envelope stored, so nothing of it was sent by this code.
    const lost: DecisionRecord = {
      v: 2,
      rubric: "v2",
      submission: "abc123",
      campaign: "camp-1",
      reviewer: ALICE.pubkey,
      outcome: "PASS",
      reason: "R00_PASS",
      signals: ALL_PASS,
      appealOf: null,
      decidedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    await conn.insert(decisionIntents).values({
      submissionId: "sub_1",
      reviewerPubkey: ALICE.pubkey,
      canonicalJson: canonicalJson(lost),
      input: { note: "Alice's note", appealOf: null, secondsTotal: 12, secondsPerSignal: {}, sharedFundingCount: 2 },
      createdAt: new Date(Date.now() - DECISION_IN_FLIGHT_MS - 1000),
    });
    // Bob now fails it. What is recorded is still Alice's pass, under her key and her timestamp.
    const d = await decide(body(SPAM, "R06_SPAM"), BOB, ledger, conn);
    expect(d).toMatchObject({ reviewerPubkey: ALICE.pubkey, outcome: "PASS", note: "Alice's note", decisionHash: decisionHash(lost).toString("hex") });
    expect(d.ledgerKey).toBe(ledgerKey("abc123", false));
    expect(d.decidedAt.toISOString()).toBe(lost.decidedAt);
    expect(ledger.records).toEqual([lost]);
    expect(await status()).toBe("decided");
    expect(await intents()).toEqual([]);
    expect((await conn.select().from(reviewTimes))[0]).toMatchObject({ secondsTotal: 12, sharedFundingCount: 2 });
  });
});

describe("fencing a taken-over intent", () => {
  it("the request whose intent was taken over stores nothing; the new holder stores one decision", async () => {
    let open: () => void = () => undefined;
    ledger.gate = new Promise<void>((resolve) => (open = resolve));
    const alice = pass(ALICE);
    await vi.waitFor(async () => expect((await intents())[0]?.txHash).toBe("tx_1"));
    // Alice's request stalls past the in-flight window; Bob takes the intent over and resends the same envelope.
    await ageIntent();
    const bob = pass(BOB);
    await vi.waitFor(() => expect(ledger.signed).toHaveLength(1));
    await vi.waitFor(async () => expect((await intents())[0]?.createdAt.getTime()).toBeGreaterThan(Date.now() - 10_000));
    open();
    const [a, b] = await Promise.allSettled([alice, bob]);
    expect(a).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(b).toMatchObject({ status: "fulfilled", value: { txHash: "tx_1", reviewerPubkey: ALICE.pubkey } });
    expect(await conn.select().from(decisions)).toHaveLength(1);
    expect(await intents()).toEqual([]);
  });

  it("a taken-over request that has not signed yet stops before sending anything", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const sign = ledger.sign.bind(ledger);
    vi.spyOn(ledger, "sign").mockImplementationOnce(async (r) => {
      await gate;
      return sign(r);
    });
    const alice = pass(ALICE);
    await vi.waitFor(async () => expect(await intents()).toHaveLength(1));
    // Taken over while Alice was still signing.
    await conn.update(decisionIntents).set({ createdAt: new Date(Date.now() + 1000) });
    open();
    await expect(alice).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ledger.sent).toEqual([]);
  });
});

describe("the decision table holds one first pass and one re-review per submission", () => {
  const row = (id: string, appealOf: string | null) => ({
    id,
    submissionId: "sub_1",
    reviewerPubkey: ALICE.pubkey,
    outcome: "FAIL" as const,
    reasonCode: "R06_SPAM" as const,
    signals: {},
    note: "n",
    appealOf,
    canonicalJson: "{}",
    decisionHash: id,
    ledgerKey: "pw:abc123",
  });

  it("refuses a second first-pass decision and a second re-review", async () => {
    await conn.insert(decisions).values(row("dec_1", null));
    await expect(conn.insert(decisions).values(row("dec_2", null))).rejects.toThrow();
    await conn.insert(decisions).values(row("dec_3", "dec_1"));
    await expect(conn.insert(decisions).values(row("dec_4", "dec_1"))).rejects.toThrow();
    expect(await conn.select().from(decisions)).toHaveLength(2);
  });
});
