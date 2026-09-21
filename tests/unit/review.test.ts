import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, submissions } from "@/db/schema";
import { requestAppeal } from "@/services/review";
import { makeTestDb } from "./db";

const CAMPAIGN = "cmp_1";
const SUB = "sub_1";
const CONTRIBUTOR = "G_C1";

let conn: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "camp-1",
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "10",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  });
  await conn.insert(submissions).values({ id: SUB, shortId: "s1", campaignId: CAMPAIGN, contributorPubkey: CONTRIBUTOR, workUrl: "https://x.com/a/status/1", status: "rejected" });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

async function fail(n: number): Promise<void> {
  await conn.insert(decisions).values({
    id: `dec_${n}`,
    submissionId: SUB,
    reviewerPubkey: "G_REV",
    outcome: "FAIL",
    reasonCode: "R02_ORIGINAL",
    signals: {},
    note: "",
    canonicalJson: "{}",
    decisionHash: "h",
    ledgerKey: `pw:s1:${n}`,
  });
}

const appeal = () => requestAppeal(SUB, { pubkey: CONTRIBUTOR }, conn);

async function status() {
  return (await conn.select().from(submissions).where(eq(submissions.id, SUB)))[0]?.status;
}

describe("requestAppeal", () => {
  it("a rejected submission with one decision on an open campaign is appealed", async () => {
    await fail(1);
    await appeal();
    expect(await status()).toBe("appealed");
  });

  it("refused on a closed campaign", async () => {
    await fail(1);
    await conn.update(campaigns).set({ closedAt: new Date() }).where(eq(campaigns.id, CAMPAIGN));
    await expect(appeal()).rejects.toMatchObject({ code: "CONFLICT", message: "campaign is closed" });
    expect(await status()).toBe("rejected");
  });

  it("a close landing between the checks and the write leaves the submission rejected", async () => {
    await fail(1);
    const select = conn.select.bind(conn);
    let calls = 0;
    vi.spyOn(conn, "select").mockImplementation(((...args: Parameters<typeof conn.select>) => {
      calls += 1;
      // The decision count is the second read; the close is queued ahead of it.
      if (calls === 2) void conn.update(campaigns).set({ closedAt: new Date() }).where(eq(campaigns.id, CAMPAIGN)).execute();
      return select(...args);
    }) as typeof conn.select);
    await expect(appeal()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await status()).toBe("rejected");
  });

  it("refused without a decision to appeal", async () => {
    await expect(appeal()).rejects.toMatchObject({ code: "CONFLICT", message: "no decision to appeal" });
    expect(await status()).toBe("rejected");
  });

  it("refused once the one re-review is used", async () => {
    await fail(1);
    await fail(2);
    await expect(appeal()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already been used/) });
    expect(await status()).toBe("rejected");
  });

  it("refused for another contributor", async () => {
    await fail(1);
    await expect(requestAppeal(SUB, { pubkey: "G_OTHER" }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
