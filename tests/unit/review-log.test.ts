import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { eq } from "drizzle-orm";
import { campaigns, decisions, payouts, reviewTimes, roleGrants, submissions } from "@/db/schema";
import { csvCell, toCsv } from "@/lib/csv";
import { REVIEW_LOG_COLUMNS, reviewLog, reviewLogCampaigns } from "@/services/review";
import { errorResponse } from "@/lib/http";
import { makeTestDb } from "./db";

const h = vi.hoisted(() => ({ db: undefined as unknown, user: null as { pubkey: string } | null }));
vi.mock("@/db/client", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/current-user", async () => {
  const { AppError: E } = await import("@/lib/errors");
  return {
    requireUser: async () => {
      if (!h.user) throw E.unauthenticated();
      return { pubkey: h.user.pubkey, roles: new Set() };
    },
  };
});
const { GET } = await import("@/app/api/campaigns/[id]/review-log/route");

const CAMPAIGN = "cmp_1";
const FUNDER = "G_FUNDER";
const REVIEWER = "G_REV";
const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const THREE_FAIL = { ...ALL_PASS, content_original: false, not_spam: false, task_done: false };

let conn: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  h.db = conn;
  h.user = null;
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "camp-1",
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "10",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: FUNDER,
    disputeResolverPubkey: "G_DR",
  });
  await conn.insert(roleGrants).values([
    { pubkey: REVIEWER, role: "reviewer" },
    { pubkey: FUNDER, role: "funder" },
  ]);
  await conn.insert(submissions).values([
    { id: "sub_1", shortId: "s1", campaignId: CAMPAIGN, contributorPubkey: "G_C1", workUrl: "https://x.com/a/status/1", status: "paid" },
    { id: "sub_2", shortId: "s2", campaignId: CAMPAIGN, contributorPubkey: "G_C2", workUrl: "https://x.com/b/status/2", status: "rejected" },
  ]);
  // sub_1: rejected, then passed on re-review and paid.
  await conn.insert(decisions).values([
    {
      id: "dec_a",
      submissionId: "sub_1",
      reviewerPubkey: REVIEWER,
      outcome: "FAIL",
      reasonCode: "R02_ORIGINAL",
      signals: THREE_FAIL,
      note: "Looks copied, \"verbatim\" from another post",
      canonicalJson: "{}",
      decisionHash: "hash_a",
      ledgerKey: "pw:s1",
      txHash: "tx_a",
      decidedAt: new Date("2026-09-20T10:00:00Z"),
    },
    {
      id: "dec_b",
      submissionId: "sub_1",
      reviewerPubkey: REVIEWER,
      outcome: "PASS",
      reasonCode: "R00_PASS",
      signals: ALL_PASS,
      note: "Original on second look",
      appealOf: "dec_a",
      canonicalJson: "{}",
      decisionHash: "hash_b",
      ledgerKey: "pw:s1:a1",
      txHash: "tx_b",
      decidedAt: new Date("2026-09-21T10:00:00Z"),
    },
    {
      id: "dec_c",
      submissionId: "sub_2",
      reviewerPubkey: REVIEWER,
      outcome: "FAIL",
      reasonCode: "R06_SPAM",
      signals: THREE_FAIL,
      note: "=HYPERLINK(\"http://evil\")",
      canonicalJson: "{}",
      decisionHash: "hash_c",
      ledgerKey: "pw:s2",
      txHash: null,
      decidedAt: new Date("2026-09-20T12:00:00Z"),
    },
  ]);
  await conn.insert(reviewTimes).values([
    { decisionId: "dec_a", secondsTotal: 90, secondsPerSignal: {}, blind: true },
    { decisionId: "dec_b", secondsTotal: 120, secondsPerSignal: {}, blind: true },
  ]);
  await conn.insert(payouts).values({ id: "pay_1", submissionId: "sub_1", milestoneIndex: 1, amount: "10", status: "released", releaseTxHash: "tx_rel" });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

describe("reviewLog", () => {
  it("one row per decision, ordered by decidedAt, appeal linked to the first decision", async () => {
    const { campaign, rows } = await reviewLog(CAMPAIGN, { pubkey: REVIEWER }, conn);
    expect(campaign.slug).toBe("camp-1");
    expect(rows.map((r) => r.decision_id)).toEqual(["dec_a", "dec_c", "dec_b"]);
    const [first, , appeal] = rows;
    expect(first).toMatchObject({ is_appeal: false, appeal_of: null, outcome: "FAIL", reason_code: "R02_ORIGINAL", pass_count: 3, signal_content_original: false });
    expect(appeal).toMatchObject({
      is_appeal: true,
      appeal_of: "dec_a",
      outcome: "PASS",
      reason_code: "R00_PASS",
      note: "Original on second look",
      pass_count: 6,
      tx_hash: "tx_b",
      explorer_url: "https://stellar.expert/explorer/testnet/tx/tx_b",
      decided_at: "2026-09-21T10:00:00.000Z",
      review_seconds: 120,
      blind: true,
      submission_status: "paid",
      payout_status: "released",
      release_tx_hash: "tx_rel",
    });
  });

  it("an uncommitted decision is present with empty tx columns", async () => {
    const { rows } = await reviewLog(CAMPAIGN, { pubkey: REVIEWER }, conn);
    const c = rows.find((r) => r.decision_id === "dec_c");
    expect(c).toMatchObject({ tx_hash: null, explorer_url: null, review_seconds: null, payout_status: null, release_tx_hash: null });
  });

  it("every row has exactly the export columns and no planted flag", async () => {
    const { rows } = await reviewLog(CAMPAIGN, { pubkey: REVIEWER }, conn);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual([...REVIEW_LOG_COLUMNS].sort());
    expect(REVIEW_LOG_COLUMNS.some((c) => /plant|genuine_flag|fake/i.test(c))).toBe(false);
  });

  it("the campaign funder may export", async () => {
    await expect(reviewLog(CAMPAIGN, { pubkey: FUNDER }, conn)).resolves.toMatchObject({ rows: expect.any(Array) });
  });

  it("a campaign-scoped reviewer may export that campaign", async () => {
    await conn.insert(roleGrants).values({ pubkey: "G_SCOPED", role: "reviewer", campaignId: CAMPAIGN });
    await expect(reviewLog(CAMPAIGN, { pubkey: "G_SCOPED" }, conn)).resolves.toMatchObject({ rows: expect.any(Array) });
  });

  it("refuses a contributor and a funder of another campaign", async () => {
    await expect(reviewLog(CAMPAIGN, { pubkey: "G_C1" }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await conn.insert(roleGrants).values({ pubkey: "G_OTHER_FUNDER", role: "funder" });
    await expect(reviewLog(CAMPAIGN, { pubkey: "G_OTHER_FUNDER" }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a reviewer scoped to a different campaign is refused", async () => {
    await conn.insert(campaigns).values({
      id: "cmp_2",
      slug: "camp-2",
      title: "Other",
      brief: "A brief long enough to pass validation.",
      rewardAmount: "10",
      budget: "100",
      deadlineAt: new Date(Date.now() + 86_400_000),
      funderPubkey: FUNDER,
      disputeResolverPubkey: "G_DR",
    });
    await conn.insert(roleGrants).values({ pubkey: "G_SCOPED", role: "reviewer", campaignId: "cmp_2" });
    await expect(reviewLog(CAMPAIGN, { pubkey: "G_SCOPED" }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("contributor keys stay hidden from reviewers until the campaign closes; the funder always sees them", async () => {
    const keys = async (pubkey: string) => (await reviewLog(CAMPAIGN, { pubkey }, conn)).rows.map((r) => r.contributor_pubkey);
    expect(await keys(REVIEWER)).toEqual([null, null, null]);
    expect(await keys(FUNDER)).toEqual(["G_C1", "G_C2", "G_C1"]);
    await conn.update(campaigns).set({ closedAt: new Date() }).where(eq(campaigns.id, CAMPAIGN));
    expect(await keys(REVIEWER)).toEqual(["G_C1", "G_C2", "G_C1"]);
  });

  it("unknown campaign is NOT_FOUND", async () => {
    await expect(reviewLog("cmp_missing", { pubkey: REVIEWER }, conn)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reviewLogCampaigns", () => {
  it("lists campaigns with decisions for a global reviewer, none for others", async () => {
    expect(await reviewLogCampaigns({ pubkey: REVIEWER }, conn)).toEqual([{ id: CAMPAIGN, slug: "camp-1", title: "Campaign", decisions: 3 }]);
    expect(await reviewLogCampaigns({ pubkey: "G_C1" }, conn)).toEqual([]);
  });

  it("a campaign-scoped reviewer sees only that campaign", async () => {
    await conn.insert(campaigns).values({
      id: "cmp_2",
      slug: "camp-2",
      title: "Other",
      brief: "A brief long enough to pass validation.",
      rewardAmount: "10",
      budget: "100",
      deadlineAt: new Date(Date.now() + 86_400_000),
      funderPubkey: FUNDER,
      disputeResolverPubkey: "G_DR",
    });
    await conn.insert(submissions).values({ id: "sub_3", shortId: "s3", campaignId: "cmp_2", contributorPubkey: "G_C3", workUrl: "https://x.com/c/status/3" });
    await conn.insert(decisions).values({
      id: "dec_d",
      submissionId: "sub_3",
      reviewerPubkey: REVIEWER,
      outcome: "PASS",
      reasonCode: "R00_PASS",
      signals: ALL_PASS,
      note: "Fine",
      canonicalJson: "{}",
      decisionHash: "hash_d",
      ledgerKey: "pw:s3",
    });
    await conn.insert(roleGrants).values({ pubkey: "G_SCOPED", role: "reviewer", campaignId: "cmp_2" });
    expect(await reviewLogCampaigns({ pubkey: "G_SCOPED" }, conn)).toEqual([{ id: "cmp_2", slug: "camp-2", title: "Other", decisions: 1 }]);
  });
});

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(-3)).toBe("-3");
  });

  it("neutralises formula injection", () => {
    for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("plain")).toBe("plain");
  });

  it("writes a header and CRLF-terminated rows", () => {
    expect(toCsv(["a", "b"] as const, [{ a: "1", b: null }])).toBe("a,b\r\n1,\r\n");
  });
});

describe("GET /api/campaigns/[id]/review-log", () => {
  const call = (id: string, qs = "") => GET(new Request(`http://localhost/api/campaigns/${id}/review-log${qs}`), { params: Promise.resolve({ id }) });

  it("reviewer gets a CSV attachment with both decisions of the re-reviewed submission", async () => {
    h.user = { pubkey: REVIEWER };
    const res = await call(CAMPAIGN);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="review-log-camp-1.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const lines = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes).trimEnd().split("\r\n");
    expect(lines[0]).toBe(REVIEW_LOG_COLUMNS.join(","));
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith("camp-1,s1,"))).toHaveLength(2);
    expect(lines.join("\n")).toContain("https://stellar.expert/explorer/testnet/tx/tx_b");
    expect(lines.join("\n")).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it("?format=json returns the same rows as a JSON array", async () => {
    h.user = { pubkey: REVIEWER };
    const res = await call(CAMPAIGN, "?format=json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(3);
    expect(body[2]).toMatchObject({ decision_id: "dec_b", is_appeal: true, appeal_of: "dec_a" });
  });

  it("anonymous 401, contributor 403, unknown campaign 404, bad format 400", async () => {
    expect((await call(CAMPAIGN)).status).toBe(401);
    h.user = { pubkey: "G_C1" };
    expect((await call(CAMPAIGN)).status).toBe(403);
    h.user = { pubkey: REVIEWER };
    expect((await call("cmp_missing")).status).toBe(404);
    expect((await call(CAMPAIGN, "?format=xlsx")).status).toBe(400);
    expect((await call("bad id!")).status).toBe(400);
  });
});

describe("errorResponse", () => {
  it("an unexpected error is a bare 500 that leaks nothing", async () => {
    const res = errorResponse(new Error("db password xyz"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "INTERNAL", message: "internal error" });
    expect(text).not.toContain("xyz");
  });
});
