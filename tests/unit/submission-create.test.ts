import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, escrowOps, submissions, type EscrowOp } from "@/db/schema";
import { STALE_SUBMITTED_MS } from "@/services/escrow-ops";
import { log } from "@/lib/logger";
import { createSubmission, type FundingSourceReader, type TrustlineReader } from "@/services/submission";
import { makeTestDb } from "./db";

const CONTRIBUTOR = { pubkey: "GCDSL5MRXQ44BWITRLP23BUUKH3OA4ITCLYAMNDDASH4BGONXKWY2NX5" };
const INPUT = { campaignSlug: "camp-1", workUrl: "https://x.com/deniz/status/1234567890" };
const FRIENDBOT = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const CREATOR = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";

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
  vi.restoreAllMocks();
  await close();
});

const reader =
  (answer: boolean): TrustlineReader =>
  async () =>
    answer;

const fundedBy =
  (source: string | null): FundingSourceReader =>
  async () =>
    source;

describe("createSubmission trustline gate", () => {
  it("refuses a wallet without a USDC trustline with CONFLICT and writes nothing", async () => {
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(false), fundedBy(FRIENDBOT))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "wallet needs a USDC trustline",
    });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("accepts a wallet that can receive USDC", async () => {
    const asked: string[] = [];
    const s = await createSubmission(
      INPUT,
      CONTRIBUTOR,
      conn,
      async (pk) => {
        asked.push(pk);
        return true;
      },
      fundedBy(FRIENDBOT),
    );
    expect(s.contributorPubkey).toBe(CONTRIBUTOR.pubkey);
    expect(asked).toEqual([CONTRIBUTOR.pubkey]);
  });

  it("fails closed when Horizon cannot be read", async () => {
    const down: TrustlineReader = async () => {
      throw new Error("Horizon answered 503");
    };
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, down, fundedBy(FRIENDBOT))).rejects.toMatchObject({ code: "LEDGER" });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("reports a duplicate before asking Horizon", async () => {
    await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT));
    let asked = false;
    await expect(
      createSubmission(
        INPUT,
        CONTRIBUTOR,
        conn,
        async () => {
          asked = true;
          return true;
        },
        fundedBy(FRIENDBOT),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "you already submitted to this campaign" });
    expect(asked).toBe(false);
  });
});

describe("createSubmission funding source", () => {
  it("stores the account that created the session wallet", async () => {
    const asked: string[] = [];
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), async (pk) => {
      asked.push(pk);
      return CREATOR;
    });
    expect(asked).toEqual([CONTRIBUTOR.pubkey]);
    expect(s.fundingSource).toBe(CREATOR);
    expect((await conn.select().from(submissions))[0]?.fundingSource).toBe(CREATOR);
  });

  it("stores a public source raw, so the exclusion list applies when the queue is read", async () => {
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT));
    expect(s.fundingSource).toBe(FRIENDBOT);
  });

  it("accepts the submission with an unknown source when Horizon fails, and only logs a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const down: FundingSourceReader = async () => {
      throw new Error("Horizon answered 503");
    };
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), down);
    expect(s).toMatchObject({ status: "pending", fundingSource: null });
    expect(await conn.select().from(submissions)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("funding source lookup failed", { campaign: "camp-1", wallet: CONTRIBUTOR.pubkey, err: "Horizon answered 503" });
  });

  it("stores an unknown source when the account has no creation record", async () => {
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(null));
    expect(s).toMatchObject({ status: "pending", fundingSource: null });
  });

  it("does not look the source up for a submission the trustline gate refuses", async () => {
    let asked = false;
    await expect(
      createSubmission(INPUT, CONTRIBUTOR, conn, reader(false), async () => {
        asked = true;
        return CREATOR;
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(asked).toBe(false);
  });
});

describe("createSubmission during a close", () => {
  async function closeOp(status: EscrowOp["status"], ageMs = 0): Promise<void> {
    await conn.insert(escrowOps).values({
      id: "op_close",
      campaignId: "cmp_1",
      kind: "dispute",
      idempotencyKey: "dispute-close:cmp_1",
      payload: {},
      status,
      updatedAt: new Date(Date.now() - ageMs),
    });
  }

  it.each(["intent", "submitted", "confirmed"] as const)("refuses while the close dispute is %s and writes nothing", async (status) => {
    await closeOp(status);
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "campaign is closing",
    });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it.each(["intent", "submitted"] as const)("accepts once a %s close is stale", async (status) => {
    await closeOp(status, STALE_SUBMITTED_MS + 1_000);
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT))).resolves.toMatchObject({ status: "pending" });
  });

  it("accepts again after the close failed and the campaign is still open", async () => {
    await closeOp("failed");
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT));
    expect(s.status).toBe("pending");
  });

  it("ignores in-flight ops of other kinds", async () => {
    await conn.insert(escrowOps).values({ id: "op_rel", campaignId: "cmp_1", kind: "release", idempotencyKey: "release:cmp_1:1", payload: {}, status: "submitted" });
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT))).resolves.toMatchObject({ status: "pending" });
  });
});
