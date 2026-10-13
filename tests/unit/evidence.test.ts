import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, escrowOps, payouts, submissions } from "@/db/schema";
import { idempotencyKey } from "@/lib/ids";
import { evidenceFileNameSchema, loadCampaignEvidence, mayReplaceEvidencePage, NO_HASH, renderCampaignEvidence } from "@/services/evidence";
import { approveKeyParts, deliverKeyParts } from "@/services/op-keys";
import { makeTestDb } from "./db";

const CAMPAIGN = "cmp_1";
const CONTRACT = "CCDKBF7H5NOMNHBLYP7DFMAPBUA4YJ2DMOLETHIDNKKMLAX2PZC33WBF";
const C1 = "GCN7FQMYXUNZ6MPGKMUMOFLQZXR2DMPUWQSTCQQJJEEKOQNYC6SIY2M4";
const C2 = "GDXGFSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
const FUNDER = "GBYRWD7HPWAQYIJHTMVLQVUB26DJSVU742MZVX3M5YH55QJN46ZQANOT";
const hex = (c: string) => c.repeat(64);
const SIGNALS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };

let conn: Db;
let close: () => Promise<void>;

async function op(kind: (typeof escrowOps.$inferInsert)["kind"], key: Array<string | number>, txHash: string | null, extra: Partial<typeof escrowOps.$inferInsert> = {}) {
  await conn.insert(escrowOps).values({
    id: `op_${key.join("_")}`,
    campaignId: CAMPAIGN,
    kind,
    idempotencyKey: idempotencyKey(key),
    payload: {},
    status: "confirmed",
    txHash,
    ...extra,
  });
}

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "live-1",
    title: "Live | campaign",
    brief: "Try the product and post about it.",
    rewardAmount: "10",
    budget: "100",
    deadlineAt: new Date("2026-10-01T00:00:00Z"),
    funderPubkey: FUNDER,
    disputeResolverPubkey: "G_DR",
    escrowContractId: CONTRACT,
    fundedAt: new Date("2026-09-20T10:00:00Z"),
    closedAt: new Date("2026-09-25T10:00:00Z"),
    remainderTxHash: hex("e"),
  });
  await conn.insert(submissions).values([
    { id: "sub_1", shortId: "s1aaaaaa", campaignId: CAMPAIGN, contributorPubkey: C1, workUrl: "https://x.com/alice/status/1", status: "paid" },
    { id: "sub_2", shortId: "s2bbbbbb", campaignId: CAMPAIGN, contributorPubkey: C2, workUrl: "https://x.com/bob/status/2", status: "rejected" },
  ]);
  await conn.insert(decisions).values([
    {
      id: "dec_1",
      submissionId: "sub_1",
      reviewerPubkey: "G_REV",
      outcome: "FAIL",
      reasonCode: "R03_TASK",
      signals: SIGNALS,
      note: "first pass",
      canonicalJson: "{}",
      decisionHash: hex("1"),
      ledgerKey: "pw:s1aaaaaa",
      txHash: hex("a"),
      decidedAt: new Date("2026-09-22T10:00:00Z"),
    },
    {
      id: "dec_2",
      submissionId: "sub_1",
      reviewerPubkey: "G_REV",
      outcome: "PASS",
      reasonCode: "R00_PASS",
      signals: SIGNALS,
      note: "re-review",
      appealOf: "dec_1",
      canonicalJson: "{}",
      decisionHash: hex("2"),
      ledgerKey: "pw:s1aaaaaa:a1",
      txHash: hex("b"),
      decidedAt: new Date("2026-09-23T10:00:00Z"),
    },
    {
      id: "dec_3",
      submissionId: "sub_2",
      reviewerPubkey: "G_REV",
      outcome: "FAIL",
      reasonCode: "R06_SPAM",
      signals: SIGNALS,
      note: "spam",
      canonicalJson: "{}",
      decisionHash: hex("3"),
      ledgerKey: "pw:s2bbbbbb",
      txHash: null,
      decidedAt: new Date("2026-09-22T11:00:00Z"),
    },
  ]);
  await conn.insert(payouts).values({
    id: "pay_1",
    submissionId: "sub_1",
    milestoneIndex: 1,
    amount: "10",
    status: "released",
    releaseTxHash: hex("7"),
  });
  await op("deploy", ["deploy", CAMPAIGN], hex("0"));
  await op("fund", ["fund", CAMPAIGN], hex("f"));
  await op("append_milestones", ["append", CAMPAIGN, "sub_1"], hex("4"));
  // Recovered server op: effect seen on chain after a submit error, hash never returned.
  await op("mark_delivered", deliverKeyParts(CAMPAIGN, "sub_1"), "");
  await op("approve", approveKeyParts(CAMPAIGN, "sub_1"), hex("6"));
  await op("release", ["release", CAMPAIGN, 1], hex("7"), { payload: { unsignedHash: hex("7"), milestoneIndex: 1 } });
  await op("dispute", ["dispute-close", CAMPAIGN], hex("8"));
  await op("release", ["release", CAMPAIGN, 2], null, { status: "failed", error: "boom" });
  await op("release", ["release", CAMPAIGN, 3], null, { status: "submitted" });
});

afterEach(async () => {
  await close();
});

describe("campaign evidence dump", () => {
  it("lists every confirmed op per kind and every decision", async () => {
    const e = await loadCampaignEvidence(conn, "live-1");
    const kinds = ["deploy", "fund", "append_milestones", "mark_delivered", "approve", "release", "dispute", "withdraw_remaining"] as const;
    for (const k of kinds) expect(e.ops.get(k), k).toHaveLength(1);
    expect(e.unconfirmed).toEqual({ failedOrIntent: 1, submitted: 1 });
    expect(e.ops.get("mark_delivered")?.[0]?.detail).toBe("s1aaaaaa · GCN7…Y2M4");
    expect(e.ops.get("release")?.[0]?.detail).toBe("s1aaaaaa · GCN7…Y2M4 · 10 USDC · milestone 1");
    expect(e.ops.get("approve")?.[0]?.detail).toBe("s1aaaaaa · GCN7…Y2M4");
    // The row carries no time: the campaign row knows the sweep's hash, not when it happened.
    expect(e.ops.get("withdraw_remaining")).toEqual([{ txHash: hex("e"), detail: "remaining balance, less the Trustless Work protocol fee → funder", at: null }]);
    expect(e.decisions.map((d) => [d.ledgerKey, d.round, d.outcome, d.reasonCode])).toEqual([
      ["pw:s1aaaaaa", "first", "FAIL", "R03_TASK"],
      ["pw:s2bbbbbb", "first", "FAIL", "R06_SPAM"],
      ["pw:s1aaaaaa:a1", "re-review", "PASS", "R00_PASS"],
    ]);
  });

  it("renders stellar.expert links, marks a missing hash, and leaks no URLs or full wallets", async () => {
    const md = renderCampaignEvidence(await loadCampaignEvidence(conn, "live-1"), {
      siteUrl: "https://proofwork.online",
      generatedAt: new Date("2026-09-26T00:00:00Z"),
    });
    for (const c of ["0", "f", "4", "6", "7", "8", "e", "a", "b"]) {
      expect(md).toContain(`(https://stellar.expert/explorer/testnet/tx/${hex(c)})`);
    }
    expect(md).toContain(`| 1 | ${NO_HASH} | s1aaaaaa · GCN7…Y2M4 |`);
    expect(md).toContain("| s2bbbbbb | pw:s2bbbbbb | first | FAIL | R06_SPAM | `3333333333333333…` | not committed | [verify](https://proofwork.online/verify/dec_3) |");
    expect(md).toContain(`https://stellar.expert/explorer/testnet/contract/${CONTRACT}`);
    // The funding wallet in full, linked: for a team-run campaign it shows who funded it.
    expect(md).toContain(`| Funder wallet | [\`${FUNDER}\`](https://stellar.expert/explorer/testnet/account/${FUNDER}) |`);
    expect(md).toContain("1 op(s) prepared or failed without a confirmed effect on chain");
    expect(md).toContain("1 op(s) submitted but not yet confirmed; they may still land");
    expect(md).toContain("# Campaign evidence: Live \\| campaign\n");
    expect(md).toContain("| # | Tx | Detail | Recorded (UTC) |");
    // Headings the evidence index and README link to by anchor.
    for (const h of [
      "### Deploy escrow",
      "### Fund budget",
      "### Release reward (per contributor)",
      "### Withdraw remainder to funder",
      "## Decision records",
    ]) {
      expect(md).toContain(`\n${h}\n`);
    }
    expect(md).not.toContain("x.com");
    expect(md).not.toContain(C1);
    expect(md).not.toContain(C2);
    expect(md).not.toMatch(/planted/i);
  });

  it("lists a recovered remainder op once, not again from the campaign row", async () => {
    await op("withdraw_remaining", ["withdraw", CAMPAIGN], "");
    const rows = (await loadCampaignEvidence(conn, "live-1")).ops.get("withdraw_remaining");
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.txHash).toBe("");
  });

  it("escapes table and link syntax in cells", async () => {
    const { cell } = await import("@/services/evidence");
    expect(cell("a|b `c` [d](e)\nf")).toBe("a\\|b \\`c\\` \\[d\\](e) f");
  });

  it("refuses an unknown slug", async () => {
    await expect(loadCampaignEvidence(conn, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("where a dump may be written", () => {
  const page = async (fileName?: string) =>
    renderCampaignEvidence(await loadCampaignEvidence(conn, "live-1"), {
      siteUrl: "https://proofwork.online",
      generatedAt: new Date("2026-09-26T00:00:00Z"),
      ...(fileName === undefined ? {} : { fileName }),
    });

  it("the file name defaults to campaign", () => {
    expect(evidenceFileNameSchema.parse(undefined)).toBe("campaign");
    expect(evidenceFileNameSchema.parse("pilot-campaign")).toBe("pilot-campaign");
  });

  it.each(["", "README", "month-2.md", "../x", "a/b", "a--b", "-a", "a-", "a b", "pilot_campaign", "a".repeat(65)])("refuses %j as a file name", (name) => {
    expect(evidenceFileNameSchema.safeParse(name).success).toBe(false);
  });

  it("a new file, and this campaign's own earlier page, may be written", async () => {
    expect(mayReplaceEvidencePage(null, "live-1")).toEqual({ ok: true });
    expect(mayReplaceEvidencePage(await page(), "live-1")).toEqual({ ok: true });
    expect(mayReplaceEvidencePage(await page("pilot-campaign"), "live-1")).toEqual({ ok: true });
  });

  it("a page that is not a campaign evidence page is not replaced", () => {
    expect(mayReplaceEvidencePage("# Evidence index, Month 2\n\n| Campaign | `live-1` |\n", "live-1")).toEqual({ ok: false, reason: "it is not a campaign evidence page" });
    expect(mayReplaceEvidencePage("", "live-1")).toMatchObject({ ok: false });
  });

  it("another campaign's page is not replaced, under the default name or any other", async () => {
    expect(mayReplaceEvidencePage(await page(), "pilot-1")).toEqual({ ok: false, reason: "it holds the evidence of campaign live-1" });
    expect(mayReplaceEvidencePage(await page(), "live-10")).toMatchObject({ ok: false });
    expect(mayReplaceEvidencePage("# Campaign evidence: Something\n\nno table here\n", "live-1")).toEqual({ ok: false, reason: "it does not say which campaign it belongs to" });
  });

  it("the page names the command that wrote it, with the file name when one was given", async () => {
    expect(await page()).toContain("by `pnpm evidence:dump live-1`.");
    expect(await page("campaign")).toContain("by `pnpm evidence:dump live-1`.");
    expect(await page("pilot-campaign")).toContain("by `pnpm evidence:dump live-1 pilot-campaign`.");
  });

  it("the remainder row shows no time and says the fee is taken out", async () => {
    expect(await page()).toContain(`| 1 | [${hex("e").slice(0, 12)}…](https://stellar.expert/explorer/testnet/tx/${hex("e")}) | remaining balance, less the Trustless Work protocol fee → funder |  |`);
  });
});
