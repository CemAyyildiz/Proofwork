import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisionIntents, decisions, reviewTimes, submissions } from "@/db/schema";
import { canonicalJson, decisionHash, ledgerKey } from "@/ledger/canonical";
import type { DecisionLedger } from "@/ledger/decision-ledger";
import { decide, DECISION_IN_FLIGHT_MS, decideSchema } from "@/services/review";
import { makeTestDb } from "./db";

vi.mock("server-only", () => ({}));

const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const SPAM = { ...ALL_PASS, not_spam: false, content_original: false, follows_brief: false };
const ALICE = { pubkey: "G_ALICE" };
const BOB = { pubkey: "G_BOB" };

type Record_ = Parameters<DecisionLedger["commit"]>[0];

/** Commits nothing. `gate` holds a commit open; `fail` makes the next one throw. */
class FakeLedger implements DecisionLedger {
  readonly records: Record_[] = [];
  gate: Promise<void> | null = null;
  fail = false;
  async commit(record: Record_) {
    if (this.gate) await this.gate;
    if (this.fail) {
      this.fail = false;
      throw new Error("horizon is down");
    }
    this.records.push(record);
    return {
      txHash: `tx_${this.records.length}`,
      ledgerKey: ledgerKey(record.submission, record.appealOf !== null),
      decisionHash: decisionHash(record).toString("hex"),
      canonicalJson: canonicalJson(record),
    };
  }
}

let conn: Db;
let close: () => Promise<void>;
let ledger: FakeLedger;

const pass = (who = ALICE) => decide(decideSchema.parse({ submissionId: "sub_1", signals: ALL_PASS, reasonCode: "R00_PASS", note: "Looks fine", secondsTotal: 30 }), who, ledger, conn);
const intents = () => conn.select().from(decisionIntents);
const status = async () => (await conn.select().from(submissions).where(eq(submissions.id, "sub_1")))[0]?.status;

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

  it("frees the submission when the chain write fails, so the reviewer can record again", async () => {
    ledger.fail = true;
    await expect(pass()).rejects.toThrow("horizon is down");
    expect(await intents()).toEqual([]);
    expect(await conn.select().from(decisions)).toEqual([]);
    expect(await status()).toBe("pending");
    expect((await pass()).txHash).toBe("tx_1");
  });

  it("finishes a commit whose database write was lost with the same record, not with new input", async () => {
    // Alice's commit went out and the process died before the decision was stored.
    const lost: Record_ = {
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
    const d = await decide(
      decideSchema.parse({ submissionId: "sub_1", signals: SPAM, reasonCode: "R06_SPAM", note: "Spam", secondsTotal: 5 }),
      BOB,
      ledger,
      conn,
    );
    expect(d).toMatchObject({ reviewerPubkey: ALICE.pubkey, outcome: "PASS", note: "Alice's note", decisionHash: decisionHash(lost).toString("hex") });
    expect(d.decidedAt.toISOString()).toBe(lost.decidedAt);
    expect(ledger.records).toEqual([lost]);
    expect(await status()).toBe("decided");
    expect(await intents()).toEqual([]);
    expect((await conn.select().from(reviewTimes))[0]).toMatchObject({ secondsTotal: 12, sharedFundingCount: 2 });
  });
});
