import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, sealedReviews, submissions } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import { LIMITS, openGate } from "./funder-wallet";
import { makeTestDb } from "./db";

/**
 * POST /api/campaigns/[id]/payouts and the escrow route's input bounds,
 * through the real handlers with a signed session cookie. The database is the
 * in-process one and the escrow the in-memory fake.
 */
const world = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  conn: undefined as unknown,
  escrow: undefined as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
  }),
}));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("@/escrow", () => ({
  getEscrow: () => world.escrow,
  getPlatformKeys: () => ({ admin: "G_ADMIN", ops: "G_OPS", ledger: "G_LEDGER" }),
}));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", "s".repeat(43));
});

const payoutsRoute = await import("@/app/api/campaigns/[id]/payouts/route");
const escrowRoute = await import("@/app/api/campaigns/[id]/escrow/route");
const { encodeSession } = await import("@/lib/session");
const { confirmDeploy, confirmFund, prepareDeploy, prepareFund } = await import("@/services/campaign");

const CAMPAIGN = "cmp_1";
const SUBMISSION = "sub_1";

let conn: Db;
let close: () => Promise<void>;
let escrow: FakeEscrow;
/** Fresh keys per test, so the in-memory rate limiter starts empty for each. */
let FUNDER: string;
let FOUNDER: string;

function as(pubkey: string): void {
  world.jar.set("pw_session", encodeSession(pubkey));
}

function call(route: { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }, body: unknown, id = CAMPAIGN): Promise<Response> {
  const req = new Request(`https://proofwork.test/api/campaigns/${id}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return route.POST(req, { params: Promise.resolve({ id }) });
}

const payouts = (body: unknown, id?: string) => call(payoutsRoute, body, id);

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
  escrow = new FakeEscrow();
  world.escrow = escrow;
  FUNDER = Keypair.random().publicKey();
  FOUNDER = Keypair.random().publicKey();
});

afterEach(async () => {
  await close();
});

/** A funded campaign whose rewards are released by an external founder wallet, with one sealed-reviewed PASS. */
async function founderSealedCampaign(): Promise<void> {
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
    founderSealedReview: true,
    releaseSignerPubkey: FOUNDER,
  });
  const actor = { pubkey: FUNDER, platformAdmin: "G_ADMIN", platformOps: "G_OPS" };
  const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
  await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn);
  const f = await prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn);
  await confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn);
  await conn.insert(submissions).values({ id: SUBMISSION, shortId: "s1", campaignId: CAMPAIGN, contributorPubkey: "G_C1", workUrl: "https://x.com/a/status/1", status: "decided" });
  await conn.insert(decisions).values({
    id: "dec_1",
    submissionId: SUBMISSION,
    reviewerPubkey: "G_REV",
    outcome: "PASS",
    reasonCode: "R00_PASS",
    signals: {},
    note: "",
    canonicalJson: "{}",
    decisionHash: "h",
    ledgerKey: "pw:s1",
  });
  await conn.insert(sealedReviews).values({
    id: "sealed_1",
    submissionId: SUBMISSION,
    campaignId: CAMPAIGN,
    status: "finalized",
    itemRef: "proofwork:camp-1:s1",
    schemaRef: "proofwork:rubric-v2",
    revealRound: 1,
    commitDeadline: new Date(Date.now() - 20_000),
    revealDeadline: new Date(Date.now() - 10_000),
    auditorPubkey: "11".repeat(32),
    operatorPubkey: FUNDER,
    receiptVerified: true,
    finalDecisionId: "dec_1",
    createdBy: FUNDER,
  });
}

describe("payouts route, founder-sealed campaign", () => {
  it("lets the founder wallet approve and prepare the release", async () => {
    await founderSealedCampaign();
    as(FOUNDER);
    const approved = await payouts({ action: "approve", submissionIds: [SUBMISSION] });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ appended: 1 });
    const prepared = await payouts({ action: "prepare", kind: "release", submissionIds: [SUBMISSION] });
    expect(prepared.status).toBe(200);
    expect(((await prepared.json()) as { ops: unknown[] }).ops).toHaveLength(1);
  });

  it("refuses the funder on approve and release, and still lets it prepare the close", async () => {
    await founderSealedCampaign();
    as(FUNDER);
    expect((await payouts({ action: "approve", submissionIds: [SUBMISSION] })).status).toBe(403);
    expect((await payouts({ action: "prepare", kind: "release", submissionIds: [SUBMISSION] })).status).toBe(403);
    const closing = await payouts({ action: "prepare", kind: "close" });
    expect(closing.status).toBe(200);
    expect(((await closing.json()) as { ops: unknown[] }).ops).toHaveLength(1);
  });

  it("refuses the founder on the close: the campaign stays the funder's", async () => {
    await founderSealedCampaign();
    as(FOUNDER);
    expect((await payouts({ action: "prepare", kind: "close" })).status).toBe(403);
    expect((await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0]?.closedAt).toBeNull();
  });
});

describe("payout and escrow input bounds", () => {
  it("refuses a repeated submission id", async () => {
    as(FUNDER);
    const res = await payouts({ action: "approve", submissionIds: ["sub_1", "sub_1"] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("duplicate submission id");
  });

  it("refuses an oversized op id or signed transaction", async () => {
    as(FUNDER);
    for (const route of [payoutsRoute, escrowRoute]) {
      const kind = route === payoutsRoute ? "release" : "fund";
      expect((await call(route, { action: "submit", kind, opId: "o".repeat(65), signedXdr: "AAAA" })).status).toBe(400);
      expect((await call(route, { action: "submit", kind, opId: "op_1", signedXdr: "A".repeat(20_001) })).status).toBe(400);
    }
  });

  it("refuses a campaign id in the path that is not an id", async () => {
    as(FUNDER);
    for (const id of ["../admin", "x".repeat(65), "cmp 1"]) {
      expect((await payouts({ action: "prepare", kind: "close" }, id)).status).toBe(400);
      expect((await call(escrowRoute, { action: "abandon" }, id)).status).toBe(400);
    }
  });
});
