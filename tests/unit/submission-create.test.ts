import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, submissions } from "@/db/schema";
import { createSubmission, type TrustlineReader } from "@/services/submission";
import { makeTestDb } from "./db";

const CONTRIBUTOR = { pubkey: "GCDSL5MRXQ44BWITRLP23BUUKH3OA4ITCLYAMNDDASH4BGONXKWY2NX5" };
const INPUT = { campaignSlug: "camp-1", workUrl: "https://x.com/deniz/status/1234567890" };

let conn: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  await conn.insert(campaigns).values({
    id: "cmp_1",
    slug: "camp-1",
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    fundedAt: new Date(),
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  });
});

afterEach(async () => {
  await close();
});

const reader =
  (answer: boolean): TrustlineReader =>
  async () =>
    answer;

describe("createSubmission trustline gate", () => {
  it("refuses a wallet without a USDC trustline with CONFLICT and writes nothing", async () => {
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(false))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "wallet needs a USDC trustline",
    });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("accepts a wallet that can receive USDC", async () => {
    const asked: string[] = [];
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, async (pk) => {
      asked.push(pk);
      return true;
    });
    expect(s.contributorPubkey).toBe(CONTRIBUTOR.pubkey);
    expect(asked).toEqual([CONTRIBUTOR.pubkey]);
  });

  it("fails closed when Horizon cannot be read", async () => {
    const down: TrustlineReader = async () => {
      throw new Error("Horizon answered 503");
    };
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, down)).rejects.toMatchObject({ code: "LEDGER" });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("reports a duplicate before asking Horizon", async () => {
    await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true));
    let asked = false;
    await expect(
      createSubmission(INPUT, CONTRIBUTOR, conn, async () => {
        asked = true;
        return true;
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "you already submitted to this campaign" });
    expect(asked).toBe(false);
  });
});
