import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { campaigns, decisions, reviewTimes, roleGrants, submissions } from "@/db/schema";
import { parseReviewLog } from "@/domain/results";
import { canonicalJson, decisionHash, ledgerKey } from "@/ledger/canonical";
import type { DecisionLedger } from "@/ledger/decision-ledger";
import { parseCsv, toCsv } from "@/lib/csv";
import { log } from "@/lib/logger";
import { decide, decideSchema, getDecision, REVIEW_LOG_COLUMNS, reviewLog, reviewQueue, sharedFundingCounts, type FundingLinkRow } from "@/services/review";
import { createSubmission } from "@/services/submission";
import { makeTestDb } from "./db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const { ReviewCard } = await import("@/components/review-card");

const FRIENDBOT = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const PUBLIC = new Set([FRIENDBOT]);
const G_ADDRESS = /G[A-Z2-7]{55}/;
const REVIEWER = { pubkey: "G_REV" };
const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };

/** Real-shaped wallets, fresh per run: A is the account that creates others. */
const [A, B, C, D, E, F] = Array.from({ length: 6 }, () => Keypair.random().publicKey()) as [string, string, string, string, string, string];

const row = (id: string, wallet: string, source: string | null, campaignId = "cmp_1"): FundingLinkRow => ({
  id,
  campaignId,
  contributorPubkey: wallet,
  fundingSource: source,
});
const counts = (rows: FundingLinkRow[], publicSources: ReadonlySet<string> = PUBLIC) => Object.fromEntries(sharedFundingCounts(rows, publicSources));

describe("sharedFundingCounts", () => {
  it("shared source: two wallets created by the same non-public account count each other", () => {
    expect(counts([row("b", B, A), row("c", C, A)])).toEqual({ b: 1, c: 1 });
  });

  it("parent and child: a wallet and the wallet it created count each other", () => {
    expect(counts([row("a", A, FRIENDBOT), row("b", B, A)])).toEqual({ a: 1, b: 1 });
  });

  it("a parent and its two children are each linked to the other two", () => {
    expect(counts([row("a", A, FRIENDBOT), row("b", B, A), row("c", C, A)])).toEqual({ a: 2, b: 2, c: 2 });
  });

  it("Friendbot only: wallets from the public faucet are checked and not linked", () => {
    expect(counts([row("b", B, FRIENDBOT), row("c", C, FRIENDBOT)])).toEqual({ b: 0, c: 0 });
  });

  it("other campaign: the same source in two campaigns is never compared", () => {
    expect(counts([row("b", B, A, "cmp_1"), row("c", C, A, "cmp_2")])).toEqual({ b: 0, c: 0 });
    expect(counts([row("a", A, FRIENDBOT, "cmp_1"), row("b", B, A, "cmp_2")])).toEqual({ a: 0, b: 0 });
  });

  it("unknown source: not checked, and never a link for another submission", () => {
    expect(counts([row("b", B, null), row("c", C, null)])).toEqual({ b: null, c: null });
    expect(counts([row("b", B, null), row("c", C, A), row("d", D, A)])).toEqual({ b: null, c: 1, d: 1 });
    // The parent's own source is unknown, so it takes no part in any link.
    expect(counts([row("a", A, null), row("b", B, A)])).toEqual({ a: null, b: 0 });
  });

  it("a configured public source stops linking, for rows already stored", () => {
    const rows = [row("b", B, A), row("c", C, A)];
    expect(counts(rows, PUBLIC)).toEqual({ b: 1, c: 1 });
    expect(counts(rows, new Set([FRIENDBOT, A]))).toEqual({ b: 0, c: 0 });
  });

  it("a public account that submits is not linked to the wallets it created", () => {
    expect(counts([row("f", FRIENDBOT, D), row("b", B, FRIENDBOT)])).toEqual({ f: 0, b: 0 });
  });
});

let conn: Db;
let close: () => Promise<void>;

/** Commits nothing: returns what the real ledger would, derived from the record alone. */
class FakeLedger implements DecisionLedger {
  readonly records: unknown[] = [];
  async commit(record: Parameters<DecisionLedger["commit"]>[0]) {
    this.records.push(record);
    return {
      txHash: `tx_${this.records.length}`,
      ledgerKey: ledgerKey(record.submission, record.appealOf !== null),
      decisionHash: decisionHash(record).toString("hex"),
      canonicalJson: canonicalJson(record),
    };
  }
}

async function addCampaign(n: number): Promise<void> {
  await conn.insert(campaigns).values({
    id: `cmp_${n}`,
    slug: `camp-${n}`,
    title: `Campaign ${n}`,
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    fundedAt: new Date(),
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  });
}

let post = 1000;

/** Submits through the service with the wallet's creator, or a failing Horizon when `source` is an Error. */
async function submit(wallet: string, source: string | null | Error, campaign = 1): Promise<string> {
  post += 1;
  const s = await createSubmission(
    { campaignSlug: `camp-${campaign}`, workUrl: `https://x.com/user/status/${post}` },
    { pubkey: wallet },
    conn,
    async () => true,
    async () => {
      if (source instanceof Error) throw source;
      return source;
    },
    // Every wallet here submits its own post from its own X account; that gate is covered in submission-create.test.ts.
    async () => ({ found: true, authorId: "111" }),
    async () => ({ xUserId: "111" }),
  );
  return s.id;
}

async function shown(publicSources: ReadonlySet<string> = PUBLIC): Promise<Map<string, number | null>> {
  return new Map((await reviewQueue(conn, publicSources)).map((q) => [q.submissionId, q.sharedFundingCount]));
}

/**
 * Decides as the card does: posts the count the card rendered with. `shown` is
 * that count when the test read the queue itself; otherwise the queue is read now.
 */
async function pass(submissionId: string, opts: { ledger?: DecisionLedger; shown?: number | null; publicSources?: ReadonlySet<string> } = {}) {
  const sharedFundingCount = "shown" in opts ? opts.shown : (await shown(opts.publicSources)).get(submissionId);
  const body = { submissionId, signals: ALL_PASS, reasonCode: "R00_PASS", note: "Looks fine", secondsTotal: 30, secondsPerSignal: {}, sharedFundingCount };
  return decide(decideSchema.parse(body), REVIEWER, opts.ledger ?? new FakeLedger(), conn);
}

async function storedCount(decisionId: string): Promise<number | null | undefined> {
  return (await conn.select().from(reviewTimes).where(eq(reviewTimes.decisionId, decisionId)))[0]?.sharedFundingCount;
}

describe("review queue and decision", () => {
  beforeEach(async () => {
    ({ db: conn, close } = await makeTestDb());
    await addCampaign(1);
    await addCampaign(2);
    await conn.insert(roleGrants).values({ pubkey: REVIEWER.pubkey, role: "reviewer" });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await close();
  });

  /** The queue as production reads it: no set passed, so the list comes from the environment. */
  async function shownUnderEnv(publicFundingSources?: string): Promise<Map<string, number | null>> {
    // The environment is parsed once per module instance, so each call loads its own.
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
    if (publicFundingSources !== undefined) vi.stubEnv("PUBLIC_FUNDING_SOURCES", publicFundingSources);
    const fresh = await import("@/services/review");
    return new Map((await fresh.reviewQueue(conn)).map((q) => [q.submissionId, q.sharedFundingCount]));
  }

  it("default public sources: Friendbot-created wallets are not linked, a private creator still is", async () => {
    const [b, c, d, e] = [await submit(B, FRIENDBOT), await submit(C, FRIENDBOT), await submit(D, A), await submit(E, A)];
    const seen = await shownUnderEnv();
    expect([seen.get(b), seen.get(c), seen.get(d), seen.get(e)]).toEqual([0, 0, 1, 1]);
  });

  it("default public sources: a creator listed in PUBLIC_FUNDING_SOURCES links nothing", async () => {
    const [b, c] = [await submit(B, A), await submit(C, A)];
    const seen = await shownUnderEnv(A);
    expect([seen.get(b), seen.get(c)]).toEqual([0, 0]);
  });

  it("shared source: both cards carry 1 and each decision stores 1", async () => {
    const [b, c] = [await submit(B, A), await submit(C, A)];
    const seen = await shown();
    expect([seen.get(b), seen.get(c)]).toEqual([1, 1]);
    const [db, dc] = [await pass(b), await pass(c)];
    expect([await storedCount(db.id), await storedCount(dc.id)]).toEqual([1, 1]);
  });

  it("parent and child: both cards carry 1", async () => {
    const [a, b] = [await submit(A, FRIENDBOT), await submit(B, A)];
    const seen = await shown();
    expect([seen.get(a), seen.get(b)]).toEqual([1, 1]);
  });

  it("Friendbot only: no warning and a stored count of 0", async () => {
    const [b, c] = [await submit(B, FRIENDBOT), await submit(C, FRIENDBOT)];
    const seen = await shown();
    expect([seen.get(b), seen.get(c)]).toEqual([0, 0]);
    expect(await storedCount((await pass(b)).id)).toBe(0);
  });

  it("other campaign: no warning on either card", async () => {
    const [b, c] = [await submit(B, A, 1), await submit(C, A, 2)];
    const seen = await shown();
    expect([seen.get(b), seen.get(c)]).toEqual([0, 0]);
    expect(await storedCount((await pass(b)).id)).toBe(0);
  });

  it("lookup fails: submission accepted, card not checked, stored count null, warning logged", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const [b, c, d] = [await submit(B, new Error("Horizon answered 504")), await submit(C, A), await submit(D, A)];
    expect(warn).toHaveBeenCalledWith("funding source lookup failed", { campaign: "camp-1", wallet: B, err: "Horizon answered 504" });
    const seen = await shown();
    expect([seen.get(b), seen.get(c), seen.get(d)]).toEqual([null, 1, 1]);
    expect(await storedCount((await pass(b)).id)).toBeNull();
  });

  it("no creation record: treated as not checked", async () => {
    const b = await submit(B, null);
    expect((await shown()).get(b)).toBeNull();
    expect(await storedCount((await pass(b)).id)).toBeNull();
  });

  it("a source named in the public list links nothing", async () => {
    const [b, c] = [await submit(B, A), await submit(C, A)];
    const seen = await shown(new Set([FRIENDBOT, A]));
    expect([seen.get(b), seen.get(c)]).toEqual([0, 0]);
    expect(await storedCount((await pass(b, { publicSources: new Set([FRIENDBOT, A]) })).id)).toBe(0);
  });

  it("counts a linked submission that was already decided", async () => {
    const [b, c] = [await submit(B, A), await submit(C, A)];
    await pass(b);
    const seen = await shown();
    expect(seen.has(b)).toBe(false);
    expect(seen.get(c)).toBe(1);
  });

  it("a later submission does not rewrite the count stored with an earlier decision", async () => {
    const b = await submit(B, A);
    const d = await pass(b);
    await submit(C, A);
    expect(await storedCount(d.id)).toBe(0);
    const { rows } = await reviewLog("cmp_1", REVIEWER, conn);
    expect(rows.map((r) => r.shared_funding_count)).toEqual([0]);
  });

  it("stores the count the card showed, not a fresh one: a linked submission arriving before the decision changes nothing", async () => {
    const b = await submit(B, A);
    const onCard = (await shown()).get(b) ?? null;
    expect(onCard).toBe(0);
    // The reviewer still has the card open when a linked submission comes in.
    await submit(C, A);
    expect((await shown()).get(b)).toBe(1);
    const d = await pass(b, { shown: onCard });
    expect(await storedCount(d.id)).toBe(0);
    const { rows } = await reviewLog("cmp_1", REVIEWER, conn);
    expect(rows.map((r) => r.shared_funding_count)).toEqual([0]);
  });

  it("stores exactly the posted count, including a warning that a fresh read would no longer give", async () => {
    const b = await submit(B, FRIENDBOT);
    expect(await storedCount((await pass(b, { shown: 3 })).id)).toBe(3);
  });

  it("the decision body takes a count of 0 or more, or null; a missing count is null", () => {
    const body = { submissionId: "sub_1", signals: ALL_PASS, reasonCode: "R00_PASS", note: "Looks fine", secondsTotal: 30 };
    expect(decideSchema.parse(body).sharedFundingCount).toBeNull();
    expect(decideSchema.parse({ ...body, sharedFundingCount: null }).sharedFundingCount).toBeNull();
    expect(decideSchema.parse({ ...body, sharedFundingCount: 0 }).sharedFundingCount).toBe(0);
    expect(decideSchema.parse({ ...body, sharedFundingCount: 2 }).sharedFundingCount).toBe(2);
    for (const bad of [-1, 1.5, "2", true]) expect(decideSchema.safeParse({ ...body, sharedFundingCount: bad }).success).toBe(false);
  });

  it("the queue hands the reviewer a count and nothing that identifies a wallet", async () => {
    await submit(A, FRIENDBOT);
    await submit(B, A);
    await submit(C, A);
    const queue = await reviewQueue(conn, PUBLIC);
    expect(queue.map((q) => q.sharedFundingCount)).toEqual([2, 2, 2]);
    for (const q of queue) {
      expect(Object.keys(q).sort()).toEqual(["campaign", "priorDecision", "sharedFundingCount", "shortId", "status", "submissionId", "submittedAt", "workUrl"]);
    }
    expect(JSON.stringify(queue)).not.toMatch(G_ADDRESS);
  });

  it("a warning derives nothing: a linked submission passes with all six signals and the hashed record is unchanged", async () => {
    const b = await submit(B, A);
    await submit(C, A);
    const ledger = new FakeLedger();
    const d = await pass(b, { ledger });
    expect(d).toMatchObject({ outcome: "PASS", reasonCode: "R00_PASS", signals: ALL_PASS });
    expect(Object.keys(JSON.parse(d.canonicalJson) as object)).toEqual(["v", "submission", "campaign", "reviewer", "outcome", "reason", "signals", "appealOf", "decidedAt"]);
    expect(d.canonicalJson).not.toMatch(/fund/i);
    expect(d.canonicalJson).not.toContain(A);
    expect(createHash("sha256").update(d.canonicalJson, "utf8").digest("hex")).toBe(d.decisionHash);
    expect(ledger.records).toHaveLength(1);
  });

  it("the review log carries the count and pnpm results still reads the export", async () => {
    const [b, c, e, f] = [await submit(B, A), await submit(C, A), await submit(E, FRIENDBOT), await submit(F, null)];
    const decided: string[] = [];
    for (const id of [b, c, e, f]) decided.push((await pass(id)).id);
    const { rows } = await reviewLog("cmp_1", REVIEWER, conn);
    const byDecision = (cells: Array<[unknown, unknown]>) => decided.map((id) => cells.find(([decisionId]) => decisionId === id)?.[1]);
    expect(byDecision(rows.map((r) => [r.decision_id, r.shared_funding_count]))).toEqual([1, 1, 0, null]);
    // The exact bytes the review-log route serves: BOM + CSV.
    const csv = `\uFEFF${toCsv(REVIEW_LOG_COLUMNS, rows)}`;
    expect(byDecision(parseCsv(csv).rows.map((r) => [r["decision_id"], r["shared_funding_count"]]))).toEqual(["1", "1", "0", ""]);
    expect(csv).not.toContain(A);
    expect(parseReviewLog(csv)).toHaveLength(4);
  });
});

describe("Month 1 rows after the migration", () => {
  const sql = (name: string): string[] =>
    readFileSync(fileURLToPath(new URL(`../../src/db/migrations/${name}.sql`, import.meta.url)), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");
  const MONTH_1 = ["0000_overjoyed_rocket_raccoon", "0001_nebulous_bloodaxe", "0002_needy_meltdown"];
  const MONTH_2 = "0003_wandering_layla_miller";
  /** Every migration after it, from the journal: the app's queries need the whole current schema. */
  const LATER = (
    JSON.parse(readFileSync(fileURLToPath(new URL("../../src/db/migrations/meta/_journal.json", import.meta.url)), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    }
  ).entries
    .filter((e) => e.idx > 3)
    .map((e) => e.tag);

  it("the migration only adds two nullable columns", () => {
    expect(sql(MONTH_2)).toEqual([
      'ALTER TABLE "review_time" ADD COLUMN "shared_funding_count" integer;',
      'ALTER TABLE "submission" ADD COLUMN "funding_source" text;',
    ]);
  });

  it("a stored decision keeps its hash, signals and outcome; its log cell is empty and a pending row is not checked", async () => {
    const client = new PGlite();
    try {
      for (const name of MONTH_1) for (const statement of sql(name)) await client.exec(statement);
      const record = {
        v: 1 as const,
        submission: "m1aaaaaa",
        campaign: "month-1",
        reviewer: "G_REV",
        outcome: "PASS" as const,
        reason: "R00_PASS" as const,
        signals: ALL_PASS,
        appealOf: null,
        decidedAt: "2026-09-28T10:00:00.000Z",
      };
      const hash = decisionHash(record).toString("hex");
      await client.exec(`
        INSERT INTO "campaign" (id, slug, title, brief, reward_amount, budget, deadline_at, funder_pubkey, dispute_resolver_pubkey, funded_at)
          VALUES ('cmp_m1', 'month-1', 'Month 1', 'A brief long enough to pass validation.', 1, 15, now() + interval '1 day', 'G_FUNDER', 'G_DR', now());
        INSERT INTO "submission" (id, short_id, campaign_id, contributor_pubkey, work_url, status)
          VALUES ('sub_m1', 'm1aaaaaa', 'cmp_m1', '${B}', 'https://x.com/a/status/1', 'decided'),
                 ('sub_m2', 'm1bbbbbb', 'cmp_m1', '${C}', 'https://x.com/b/status/2', 'pending');
        INSERT INTO "role_grant" (pubkey, role) VALUES ('G_REV', 'reviewer');
      `);
      await client.query(
        `INSERT INTO "decision" (id, submission_id, reviewer_pubkey, outcome, reason_code, signals, note, canonical_json, decision_hash, ledger_key, tx_hash, created_at)
           VALUES ('dec_m1', 'sub_m1', 'G_REV', 'PASS', 'R00_PASS', $1, 'Fine', $2, $3, 'pw:m1aaaaaa', 'tx_m1', $4)`,
        [JSON.stringify(ALL_PASS), canonicalJson(record), hash, record.decidedAt],
      );
      await client.exec(`INSERT INTO "review_time" (decision_id, seconds_total, seconds_per_signal) VALUES ('dec_m1', 60, '{}')`);
      const before = (await client.query(`SELECT * FROM "decision" WHERE id = 'dec_m1'`)).rows[0];

      for (const statement of sql(MONTH_2)) await client.exec(statement);

      expect((await client.query(`SELECT * FROM "decision" WHERE id = 'dec_m1'`)).rows[0]).toEqual(before);
      for (const name of LATER) for (const statement of sql(name)) await client.exec(statement);
      expect((await client.query(`SELECT * FROM "decision" WHERE id = 'dec_m1'`)).rows[0]).toEqual(before);
      conn = drizzle({ client, schema });
      const read = await getDecision("dec_m1", conn);
      expect(read?.d).toMatchObject({ decisionHash: hash, canonicalJson: canonicalJson(record), signals: ALL_PASS, outcome: "PASS", reasonCode: "R00_PASS", txHash: "tx_m1" });
      expect(createHash("sha256").update(read?.d.canonicalJson ?? "", "utf8").digest("hex")).toBe(hash);

      const { rows } = await reviewLog("cmp_m1", REVIEWER, conn);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decision_id: "dec_m1", decision_hash: hash, outcome: "PASS", pass_count: 6, shared_funding_count: null });
      expect(parseCsv(toCsv(REVIEW_LOG_COLUMNS, rows)).rows.map((r) => r["shared_funding_count"])).toEqual([""]);

      // A Month 1 row has no stored source: not checked, and not counted even for a new wallet that its wallet created.
      await conn.insert(submissions).values({ id: "sub_new", shortId: "m2cccccc", campaignId: "cmp_m1", contributorPubkey: D, workUrl: "https://x.com/c/status/3", fundingSource: C });
      const queue = await reviewQueue(conn, PUBLIC);
      expect(Object.fromEntries(queue.map((q) => [q.submissionId, q.sharedFundingCount]))).toEqual({ sub_m2: null, sub_new: 0 });
      expect((await conn.select().from(decisions)).map((d) => d.decisionHash)).toEqual([hash]);
    } finally {
      await client.close();
    }
  });
});

describe("review card", () => {
  const card = (sharedFundingCount: number | null): string =>
    renderToStaticMarkup(
      createElement(ReviewCard, {
        item: {
          submissionId: "sub_1",
          shortId: "s1aaaaaa",
          workUrl: "https://x.com/a/status/1",
          submittedAt: "2026-10-12T10:00:00.000Z",
          status: "pending",
          campaign: { slug: "camp-1", title: "Campaign", brief: "A brief long enough to pass validation." },
          priorDecision: null,
          sharedFundingCount,
        },
      }),
    );
  const checkboxes = (html: string): string[] => html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("a linked card warns with the count and no wallet address", () => {
    const html = card(1);
    expect(text(html)).toContain("Shared funding source: 1 other submission in this campaign.");
    expect(text(card(3))).toContain("3 other submissions in this campaign.");
    expect(html).not.toMatch(G_ADDRESS);
    expect(html).not.toContain("not checked");
  });

  it("a linked card starts with all six signals checked, exactly as an unlinked one", () => {
    const [linked, unlinked] = [checkboxes(card(2)), checkboxes(card(0))];
    expect(linked).toHaveLength(6);
    expect(linked.every((box) => /\bchecked=""/.test(box))).toBe(true);
    expect(linked).toEqual(unlinked);
    expect(text(card(2))).toContain("6/6 pass");
    expect(text(card(2))).toContain("Record PASS");
  });

  it("an unlinked card shows no funding note", () => {
    expect(card(0)).not.toMatch(/funding/i);
  });

  it("an unknown source says it was not checked and does not warn", () => {
    const html = card(null);
    expect(text(html)).toContain("Funding source not checked.");
    expect(html).not.toContain("Shared funding source");
    expect(checkboxes(html)).toEqual(checkboxes(card(0)));
  });
});
