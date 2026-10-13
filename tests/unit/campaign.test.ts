import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, escrowOps, payouts, submissions, type Campaign } from "@/db/schema";
import { assessFunding, describeMissing, feeFloor, TRUSTLINE_RESERVE_XLM, TX_FEE_FLOOR_XLM, USDC_FAUCET_URL } from "@/domain/funding-readiness";
import { FakeEscrow } from "@/escrow/fake";
import { jsonRoute } from "@/lib/http";
import { log } from "@/lib/logger";
import { changeRole } from "@/services/access";
import {
  abandonCampaign,
  confirmDeploy,
  confirmFund,
  createCampaign,
  createCampaignSchema,
  fundingReadiness,
  funderUsage,
  prepareDeploy,
  prepareFund,
  type FunderAccountReader,
} from "@/services/campaign";
import { STALE_SUBMITTED_MS } from "@/services/escrow-ops";
import { confirmClose, prepareClose } from "@/services/payout";
import { makeTestDb } from "./db";
import { funderAccountFrom } from "@/wallet/onboarding";
import type { FakeReply } from "./fake-fetch";
import { horizonAccount, horizonAccountsOnly, LIMITS, openGate, reading, USDC_ISSUER, wallet } from "./funder-wallet";

const world = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  conn: undefined as unknown,
  escrow: null as unknown,
  platform: { admin: "", ops: "", ledger: "" },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/wallet/kit", () => ({ signTransaction: async () => "" }));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("@/escrow", () => ({ getEscrow: () => world.escrow, getPlatformKeys: () => world.platform }));

const base = {
  title: "Campaign",
  brief: "A brief long enough to pass validation.",
  rewardAmount: "10",
  deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
  disputeResolverPubkey: Keypair.random().publicKey(),
};

describe("createCampaignSchema reward cap", () => {
  it.each([
    ["490", true],
    ["499.9999999", true],
    ["500", false],
    ["10", true],
  ])("budget %s at reward 10 accepted: %s", (budget, ok) => {
    expect(createCampaignSchema.safeParse({ ...base, budget }).success).toBe(ok);
  });

  it("floor(budget / reward) = 50 fails on budget with the cap message", () => {
    const res = createCampaignSchema.safeParse({ ...base, rewardAmount: "0.1", budget: "5" });
    expect(res.success).toBe(false);
    expect(res.error?.issues).toEqual([
      expect.objectContaining({ path: ["budget"], message: "budget covers more than 49 rewards; the escrow holds 49 reward milestones" }),
    ]);
  });

  it("floor(budget / reward) = 49 is accepted", () => {
    expect(createCampaignSchema.safeParse({ ...base, rewardAmount: "0.1", budget: "4.9999999" }).success).toBe(true);
  });

  it("a zero reward fails the parse instead of dividing by zero", () => {
    const res = createCampaignSchema.safeParse({ ...base, rewardAmount: "0", budget: "100" });
    expect(res.success).toBe(false);
    expect(res.error?.issues).toEqual([expect.objectContaining({ path: ["rewardAmount"] })]);
  });

  it("a route on the schema answers VALIDATION 400", async () => {
    const route = jsonRoute(createCampaignSchema, async () => ({ ok: true }));
    const res = await route(new Request("http://test/api/campaigns", { method: "POST", body: JSON.stringify({ ...base, budget: "500" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION", details: { issues: [{ path: ["budget"] }] } });
  });
});

const FUNDER = Keypair.random().publicKey();
const PLATFORM = { admin: Keypair.random().publicKey(), ops: Keypair.random().publicKey(), ledger: Keypair.random().publicKey() };
const actor = { pubkey: FUNDER, platformAdmin: PLATFORM.admin, platformOps: PLATFORM.ops };

let conn: Db;
let close: () => Promise<void>;
let escrow: FakeEscrow;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  escrow = new FakeEscrow();
  world.conn = conn;
  world.escrow = escrow;
  world.platform = PLATFORM;
  world.jar = new Map();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await close();
});

const input = (budget: string, title = "Campaign") => createCampaignSchema.parse({ ...base, title, budget });

/** A campaign saved by `who`, not deployed. */
const draft = (budget: string, who = actor, limits = LIMITS) => createCampaign(input(budget), who, limits, conn);

async function deploy(c: Campaign, who = actor, gate = openGate()): Promise<void> {
  const d = await prepareDeploy(c.id, who, escrow, gate, conn);
  await confirmDeploy({ campaignId: c.id, opId: d.opId, signedXdr: d.unsignedXdr }, who, escrow, LIMITS, conn);
}

async function fund(c: Campaign, who = actor, account: FunderAccountReader = openGate().account): Promise<void> {
  const f = await prepareFund(c.id, who, escrow, account, conn);
  await confirmFund({ campaignId: c.id, opId: f.opId, signedXdr: f.unsignedXdr }, who, escrow, conn);
}

/** A campaign whose escrow is deployed: from here it counts against its funder's caps. */
async function deployed(budget: string, who = actor): Promise<Campaign> {
  const c = await draft(budget, who);
  await deploy(c, who);
  return c;
}

const campaignRows = () => conn.select().from(campaigns);
const opRows = () => conn.select().from(escrowOps);

async function campaignRow(id: string): Promise<Campaign> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, id)))[0];
  if (!c) throw new Error("campaign missing");
  return c;
}

describe("per-funder caps", () => {
  it("under both caps: with one open campaign of 40, one of 50 is created", async () => {
    await deployed("40");
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 1, openBudget: "40" });
    const c = await draft("50");
    expect(c).toMatchObject({ funderPubkey: FUNDER, budget: "50.0000000" });
    expect(await campaignRows()).toHaveLength(2);
  });

  it("campaign cap: a third campaign is refused, naming the cap and the usage, and nothing is stored", async () => {
    await deployed("10");
    await deployed("10");
    await expect(draft("10")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "open-campaign limit reached: this wallet has 2 of 2 open campaigns in use, close one first",
      details: { caps: [{ cap: "open_campaigns", limit: "2", used: "2" }] },
    });
    expect(await campaignRows()).toHaveLength(2);
  });

  it("budget cap: with 80 open, 30 more is refused, naming the cap and the usage", async () => {
    await deployed("80");
    await expect(draft("30")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "open-budget limit exceeded: this wallet has 80 of 100 USDC in use, which leaves no room for a 30 USDC campaign",
      details: { caps: [{ cap: "open_budget", limit: "100", used: "80" }] },
    });
    expect(await campaignRows()).toHaveLength(1);
    // What still fits is accepted, to the last stroop.
    await expect(draft("20.0000001")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await draft("20")).budget).toBe("20.0000000");
  });

  it("a budget above the cap on its own is refused on the budget cap, with nothing open", async () => {
    await expect(draft("150")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "open-budget limit exceeded: this wallet has 0 of 100 USDC in use, which leaves no room for a 150 USDC campaign",
    });
    expect(await campaignRows()).toHaveLength(0);
    expect((await draft("100")).budget).toBe("100.0000000");
  });

  it("names both caps when a campaign breaks both", async () => {
    await deployed("50");
    await deployed("50");
    const refusal = await draft("10").catch((e: unknown) => e);
    expect(refusal).toMatchObject({ code: "CONFLICT", details: { caps: [{ cap: "open_campaigns" }, { cap: "open_budget" }] } });
    expect((refusal as Error).message).toContain("2 of 2 open campaigns");
    expect((refusal as Error).message).toContain("100 of 100 USDC");
  });

  it("drafts pile up: three are saved, two deploy, and the third deploy is refused on the campaign cap", async () => {
    const [a, b, c] = [await draft("10", actor), await draft("10", actor), await draft("10", actor)];
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 0, openBudget: "0" });
    await deploy(a);
    await deploy(b);
    const gate = openGate();
    await expect(prepareDeploy(c.id, actor, escrow, gate, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("this wallet has 2 of 2 open campaigns in use"),
    });
    // Refused before the wallet was read and before anything was recorded for the third campaign.
    expect(gate.account.reads).toBe(0);
    expect((await opRows()).filter((o) => o.campaignId === c.id)).toEqual([]);
    expect((await campaignRow(c.id)).escrowContractId).toBeNull();
  });

  it("deploy adds the campaign to what the others use: the second of two 60 USDC drafts is refused on the budget cap", async () => {
    const [a, b] = [await draft("60"), await draft("60")];
    await deploy(a);
    await expect(prepareDeploy(b.id, actor, escrow, openGate(), conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "open-budget limit exceeded: this wallet has 60 of 100 USDC in use, which leaves no room for a 60 USDC campaign",
    });
    expect((await opRows()).filter((o) => o.campaignId === b.id)).toEqual([]);
  });

  it("a closed campaign frees the cap: a new one can be created and deployed", async () => {
    const a = await deployed("10");
    await deployed("10");
    await expect(draft("10")).rejects.toMatchObject({ code: "CONFLICT" });

    await fund(a);
    const closing = await prepareClose(a.id, actor, escrow, conn);
    await confirmClose({ campaignId: a.id, opId: closing.opId, signedXdr: closing.unsignedXdr }, actor, escrow, conn);
    expect((await campaignRow(a.id)).closedAt).toBeInstanceOf(Date);
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 1, openBudget: "10" });

    const c = await draft("10");
    await deploy(c);
    expect((await campaignRow(c.id)).escrowContractId).not.toBeNull();
  });

  it("deploys prepared while under the cap cannot all be submitted: the cap is checked again before a signed deploy is sent", async () => {
    const [a, b, c] = [await draft("10"), await draft("10"), await draft("10")];
    // All three are prepared while nothing is open, so each passes the check at prepare.
    const prepared = [];
    for (const x of [a, b, c]) prepared.push(await prepareDeploy(x.id, actor, escrow, openGate(), conn));
    const [pa, pb, pc] = prepared;
    if (!pa || !pb || !pc) throw new Error("prepare failed");
    await confirmDeploy({ campaignId: a.id, opId: pa.opId, signedXdr: pa.unsignedXdr }, actor, escrow, LIMITS, conn);
    await confirmDeploy({ campaignId: b.id, opId: pb.opId, signedXdr: pb.unsignedXdr }, actor, escrow, LIMITS, conn);
    expect(escrow.submits).toBe(2);

    await expect(confirmDeploy({ campaignId: c.id, opId: pc.opId, signedXdr: pc.unsignedXdr }, actor, escrow, LIMITS, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("this wallet has 2 of 2 open campaigns in use"),
    });
    // The signed transaction never reached the network and its record is as it was.
    expect(escrow.submits).toBe(2);
    expect((await opRows()).find((o) => o.id === pc.opId)?.status).toBe("intent");
    expect((await campaignRow(c.id)).escrowContractId).toBeNull();
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 2, openBudget: "20" });
  });

  it("the budget cap is checked at submit as well", async () => {
    const [a, b] = [await draft("60"), await draft("60")];
    const pa = await prepareDeploy(a.id, actor, escrow, openGate(), conn);
    const pb = await prepareDeploy(b.id, actor, escrow, openGate(), conn);
    await confirmDeploy({ campaignId: a.id, opId: pa.opId, signedXdr: pa.unsignedXdr }, actor, escrow, LIMITS, conn);
    await expect(confirmDeploy({ campaignId: b.id, opId: pb.opId, signedXdr: pb.unsignedXdr }, actor, escrow, LIMITS, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "open-budget limit exceeded: this wallet has 60 of 100 USDC in use, which leaves no room for a 60 USDC campaign",
    });
    expect(escrow.submits).toBe(1);
  });

  it("a deploy that is already confirmed is replayed before the caps and the wallet are looked at", async () => {
    const c = await deployed("50");
    const contractId = (await campaignRow(c.id)).escrowContractId;
    expect(contractId).not.toBeNull();
    // The op is confirmed, but the write of the contract id to the campaign was lost.
    await conn.update(campaigns).set({ escrowContractId: null }).where(eq(campaigns.id, c.id));

    // A gate that would refuse on every count: one campaign, 1 USDC, and a wallet with no account.
    const refusing = { limits: { maxOpenCampaigns: 1, maxOpenBudget: "1" }, account: reading({ kind: "no-account" }) };
    await expect(prepareDeploy(c.id, actor, escrow, refusing, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("deploy already confirmed"),
    });
    expect(refusing.account.reads).toBe(0);
    expect((await campaignRow(c.id)).escrowContractId).toBe(contractId);
    expect(escrow.submits).toBe(1);
  });

  it("counts each funder on its own", async () => {
    const other = { ...actor, pubkey: Keypair.random().publicKey() };
    await deployed("50", other);
    await deployed("50", other);
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 0, openBudget: "0" });
    await expect(draft("100")).resolves.toMatchObject({ funderPubkey: FUNDER });
  });

  it("follows the limits it is given, in the check and in the message", async () => {
    const tight = { maxOpenCampaigns: 1, maxOpenBudget: "25" };
    await expect(draft("30", actor, tight)).rejects.toMatchObject({ message: expect.stringContaining("0 of 25 USDC in use") });
    const c = await draft("20", actor, tight);
    await deploy(c, actor, { ...openGate(), limits: tight });
    await expect(draft("10", actor, tight)).rejects.toMatchObject({
      message:
        "open-campaign limit reached: this wallet has 1 of 1 open campaigns in use, close one first; " +
        "open-budget limit exceeded: this wallet has 20 of 25 USDC in use, which leaves no room for a 10 USDC campaign",
    });
    const wide = { maxOpenCampaigns: 5, maxOpenBudget: "1000" };
    await expect(draft("400", actor, wide)).resolves.toMatchObject({ budget: "400.0000000" });
  });
});

describe("abandoning a deployed campaign that was never funded", () => {
  it("closes it without touching the chain, frees the cap, and the campaign can no longer be funded", async () => {
    const a = await deployed("60");
    const b = await deployed("40");
    await expect(draft("10")).rejects.toMatchObject({ code: "CONFLICT" });
    // A fund prepared before the campaign is abandoned, never signed.
    const stale = await prepareFund(a.id, actor, escrow, openGate().account, conn);
    const submits = escrow.submits;

    const closed = await abandonCampaign(a.id, actor, conn);
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(closed.fundedAt).toBeNull();
    expect(escrow.submits).toBe(submits);
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 1, openBudget: "40" });

    // The cap is free again: a new campaign is created and deployed.
    const c = await draft("60");
    await deploy(c);
    expect((await campaignRow(c.id)).escrowContractId).not.toBeNull();

    // No money goes into the abandoned one, by a new fund or by the one prepared earlier.
    await expect(prepareFund(a.id, actor, escrow, openGate().account, conn)).rejects.toMatchObject({ code: "CONFLICT", message: "campaign is closed" });
    await expect(confirmFund({ campaignId: a.id, opId: stale.opId, signedXdr: stale.unsignedXdr }, actor, escrow, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "campaign is closed",
    });
    expect(escrow.submits).toBe(submits + 1); // the deploy of the new campaign, nothing else
    expect((await escrow.getEscrow((await campaignRow(a.id)).escrowContractId ?? "")).balance).toBe("0");
    await expect(abandonCampaign(a.id, actor, conn)).rejects.toMatchObject({ code: "CONFLICT", message: "campaign already closed" });
    expect((await campaignRow(b.id)).closedAt).toBeNull();
  });

  it("is refused for a funded campaign", async () => {
    const c = await deployed("50");
    await fund(c);
    await expect(abandonCampaign(c.id, actor, conn)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("campaign is funded") });
    expect((await campaignRow(c.id)).closedAt).toBeNull();
  });

  it.each(["submitted", "failed", "confirmed"] as const)("is refused when a fund transaction was sent and its record is %s", async (status) => {
    const c = await deployed("50");
    const f = await prepareFund(c.id, actor, escrow, openGate().account, conn);
    await conn.update(escrowOps).set({ status }).where(eq(escrowOps.id, f.opId));
    await expect(abandonCampaign(c.id, actor, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("a fund transaction was sent for this campaign"),
    });
    expect((await campaignRow(c.id)).closedAt).toBeNull();
  });

  it("is refused for a draft, and for a wallet that does not own the campaign", async () => {
    const d = await draft("50");
    await expect(abandonCampaign(d.id, actor, conn)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("not deployed") });
    const c = await deployed("50");
    await expect(abandonCampaign(c.id, { pubkey: Keypair.random().publicKey() }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await campaignRow(c.id)).closedAt).toBeNull();
  });
});

describe("assessFunding", () => {
  it("is ready when the wallet covers the budget and the fees still ahead of it", () => {
    expect(assessFunding(wallet("50", "1"), "50", "deploy")).toEqual({ status: "ready", usdc: "50", xlm: "1" });
    expect(assessFunding(wallet("50", "0.5"), "50", "fund")).toEqual({ status: "ready", usdc: "50", xlm: "0.5" });
  });

  it("needs the fees of two transactions before deploy and of one before fund", () => {
    expect(TX_FEE_FLOOR_XLM).toBe("0.5");
    expect([feeFloor("deploy"), feeFloor("fund")]).toEqual(["1", "0.5"]);
    expect(assessFunding(wallet("50", "0.9999999"), "50", "deploy")).toEqual({
      status: "not-ready",
      missing: [{ item: "xlm", have: "0.9999999", need: "1" }],
    });
    expect(assessFunding(wallet("50", "0.9999999"), "50", "fund").status).toBe("ready");
    expect(assessFunding(wallet("50", "0.4999999"), "50", "fund")).toEqual({
      status: "not-ready",
      missing: [{ item: "xlm", have: "0.4999999", need: "0.5" }],
    });
  });

  it("lists everything a wallet with no account lacks, at once", () => {
    expect(assessFunding({ kind: "no-account" }, "50", "deploy")).toEqual({
      status: "not-ready",
      missing: [
        { item: "account" },
        { item: "trustline" },
        { item: "usdc", have: "0", need: "50" },
        { item: "xlm", have: "0", need: "1.5", forTrustline: true },
      ],
    });
  });

  it("counts the reserve of a missing trustline in the XLM needed, so the shortage shows before the line is added", () => {
    expect(TRUSTLINE_RESERVE_XLM).toBe("0.5");
    // 2.2 XLM and no subentries: 1.2 XLM free. Deploy and fund need 1, and the trustline will lock 0.5 more.
    const account = funderAccountFrom(horizonAccount(null, "2.2000000"), USDC_ISSUER);
    expect(account).toMatchObject({ kind: "account", usdc: null, xlm: { spendable: "1.2" } });
    expect(assessFunding(account, "50", "deploy")).toEqual({
      status: "not-ready",
      missing: [{ item: "trustline" }, { item: "usdc", have: "0", need: "50" }, { item: "xlm", have: "1.2", need: "1.5", forTrustline: true }],
    });
    // With the line in place the same free XLM is enough: the reserve is already out of it.
    expect(assessFunding(wallet("50", "1.2"), "50", "deploy").status).toBe("ready");
    // 0.5 more free and the wallet without the line lacks only the line and the USDC.
    expect(assessFunding(wallet(null, "1.5"), "50", "deploy")).toEqual({
      status: "not-ready",
      missing: [{ item: "trustline" }, { item: "usdc", have: "0", need: "50" }],
    });
    expect(describeMissing({ item: "xlm", have: "1.2", need: "1.5", forTrustline: true })).toMatch(
      /needs 1\.5 XLM, 0\.5 XLM of it for the reserve the USDC trustline will hold\./,
    );
  });

  it("lists the trustline and the USDC for an account without the line", () => {
    expect(assessFunding(wallet(null), "50", "deploy")).toEqual({
      status: "not-ready",
      missing: [{ item: "trustline" }, { item: "usdc", have: "0", need: "50" }],
    });
  });

  it("compares amounts as decimals, to the stroop", () => {
    expect(assessFunding(wallet("49.9999999"), "50", "deploy")).toEqual({
      status: "not-ready",
      missing: [{ item: "usdc", have: "49.9999999", need: "50" }],
    });
    expect(assessFunding(wallet("50.0000000"), "50", "deploy").status).toBe("ready");
    // 0.1 + 0.2 as floats is not 0.3; as stroops it is.
    expect(assessFunding(wallet("0.3"), "0.3000000", "fund").status).toBe("ready");
    // A budget beyond what a float holds exactly is still compared exactly.
    expect(assessFunding(wallet("9007199254740993"), "9007199254740993.0000001", "fund").status).toBe("not-ready");
  });

  it("counts what can be spent, not the balance", () => {
    const tiedUp = { ...wallet("50"), usdc: { balance: "50", sellingLiabilities: "20", spendable: "30" } };
    expect(assessFunding(tiedUp, "50", "fund")).toEqual({ status: "not-ready", missing: [{ item: "usdc", have: "30", need: "50" }] });
  });

  it("says what to do about each missing item", () => {
    expect(describeMissing({ item: "account" })).toMatch(/Activate it/);
    expect(describeMissing({ item: "trustline" })).toMatch(/Add the USDC trustline/);
    const usdc = describeMissing({ item: "usdc", have: "3", need: "50" });
    expect(usdc).toContain("3 USDC");
    expect(usdc).toContain("50 USDC");
    expect(usdc).toContain(USDC_FAUCET_URL);
    expect(usdc).toContain("Stellar Testnet");
    expect(describeMissing({ item: "xlm", have: "0.2", need: "1" })).toMatch(/has 0\.2 XLM free.*needs 1 XLM\. /);
  });
});

describe("readiness gate on deploy and fund", () => {
  const ready = () => ({ limits: LIMITS, account: reading(wallet("50", "5")) });
  const gateFor = (account: FunderAccountReader) => ({ limits: LIMITS, account });
  const down: FunderAccountReader = async () => {
    throw new Error("Horizon answered 503");
  };

  it("ready: the deploy and the fund transactions are built, each after one read of the funder's wallet", async () => {
    const c = await draft("50");
    const seen: string[] = [];
    const account: FunderAccountReader = async (pubkey) => {
      seen.push(pubkey);
      return wallet("50", "5");
    };
    const d = await prepareDeploy(c.id, actor, escrow, gateFor(account), conn);
    expect(d.unsignedXdr).not.toBe("");
    await confirmDeploy({ campaignId: c.id, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn);
    const f = await prepareFund(c.id, actor, escrow, account, conn);
    await confirmFund({ campaignId: c.id, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn);
    expect((await campaignRow(c.id)).fundedAt).toBeInstanceOf(Date);
    expect(seen).toEqual([FUNDER, FUNDER]);
    expect(await fundingReadiness(FUNDER, "50", "deploy", ready().account)).toEqual({ status: "ready", usdc: "50", xlm: "5" });
  });

  it.each([
    ["no account", { kind: "no-account" } as const, /does not exist on Stellar testnet.*Activate it/],
    ["no trustline", wallet(null, "5"), /no USDC trustline\. Add the USDC trustline/],
    ["short of USDC", wallet("49.9999999", "5"), /has 49\.9999999 USDC to spend and the budget is 50 USDC.*faucet\.circle\.com/],
    ["short of XLM", wallet("50", "0.2"), /has 0\.2 XLM free for network fees and needs 1 XLM/],
  ])("%s: the deploy is refused with what is missing, and no op is recorded", async (_label, account, message) => {
    const c = await draft("50");
    const reader = reading(account);
    const refusal = await prepareDeploy(c.id, actor, escrow, gateFor(reader), conn).catch((e: unknown) => e);
    expect(refusal).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(message) });
    expect((refusal as Error).message).toMatch(/^your wallet is not ready to deploy the escrow\. /);
    expect(reader.reads).toBe(1);
    expect(await opRows()).toEqual([]);
    expect((await campaignRow(c.id)).escrowContractId).toBeNull();
  });

  it("no account: the refusal lists all four missing items at once", async () => {
    const c = await draft("50");
    const refusal = await prepareDeploy(c.id, actor, escrow, gateFor(reading({ kind: "no-account" })), conn).catch((e: unknown) => e);
    expect(refusal).toMatchObject({ details: { missing: [{ item: "account" }, { item: "trustline" }, { item: "usdc" }, { item: "xlm" }] } });
  });

  it("short of USDC: the fund is refused too, and no fund op is recorded", async () => {
    const c = await deployed("50");
    const reader = reading(wallet("12.5", "5"));
    await expect(prepareFund(c.id, actor, escrow, reader, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/^your wallet is not ready to fund the budget\. The wallet has 12\.5 USDC to spend and the budget is 50 USDC\./),
      details: { missing: [{ item: "usdc", have: "12.5", need: "50" }] },
    });
    expect((await opRows()).filter((o) => o.kind === "fund")).toEqual([]);
    expect((await campaignRow(c.id)).fundedAt).toBeNull();
  });

  it("a fund needs the fee of one transaction only", async () => {
    const c = await deployed("50");
    await expect(prepareFund(c.id, actor, escrow, reading(wallet("50", "0.6")), conn)).resolves.toMatchObject({ kind: "fund" });
  });

  it("Horizon down: readiness is not checked, deploy and fund are refused with a try-again message, and the failure is logged", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    expect(await fundingReadiness(FUNDER, "50", "deploy", down)).toEqual({ status: "unchecked" });

    const c = await draft("50");
    await expect(prepareDeploy(c.id, actor, escrow, gateFor(down), conn)).rejects.toMatchObject({
      code: "LEDGER",
      message: "couldn't check your wallet on Stellar, try again",
    });
    expect(await opRows()).toEqual([]);

    await deploy(c);
    await expect(prepareFund(c.id, actor, escrow, down, conn)).rejects.toMatchObject({ code: "LEDGER", message: expect.stringContaining("try again") });
    expect((await opRows()).filter((o) => o.kind === "fund")).toEqual([]);
    expect(warn).toHaveBeenCalledWith("funder wallet read failed", { wallet: FUNDER, step: "fund", err: "Horizon answered 503" });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("only a failed read is reported as not checked: an error in the rules is thrown, not blamed on Stellar", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await expect(fundingReadiness(FUNDER, "not an amount", "deploy", reading(wallet("50", "5")))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a fund already on chain is reconciled without reading the wallet, which the budget has left", async () => {
    const c = await deployed("50");
    const f = await prepareFund(c.id, actor, escrow, ready().account, conn);
    // The transaction lands, but the server never records the answer: the op stays `submitted`.
    await escrow.submit(f.unsignedXdr);
    await conn.update(escrowOps).set({ status: "submitted", updatedAt: new Date(Date.now() - STALE_SUBMITTED_MS - 1000) }).where(eq(escrowOps.id, f.opId));

    const emptied = reading(wallet("0", "5"));
    await expect(prepareFund(c.id, actor, escrow, emptied, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("fund already confirmed"),
    });
    expect(emptied.reads).toBe(0);
    expect((await campaignRow(c.id)).fundedAt).toBeInstanceOf(Date);
    expect((await opRows()).find((o) => o.id === f.opId)?.status).toBe("confirmed");
  });

  it("a fund that failed without landing is rebuilt only for a wallet that is ready", async () => {
    const c = await deployed("50");
    const f = await prepareFund(c.id, actor, escrow, ready().account, conn);
    await conn.update(escrowOps).set({ status: "failed", error: "send-transaction timed out" }).where(eq(escrowOps.id, f.opId));

    await expect(prepareFund(c.id, actor, escrow, reading(wallet("0", "5")), conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("not ready to fund the budget"),
    });
    expect((await opRows()).find((o) => o.id === f.opId)?.status).toBe("failed");

    const rebuilt = await prepareFund(c.id, actor, escrow, ready().account, conn);
    expect(rebuilt.opId).toBe(f.opId);
    expect((await opRows()).find((o) => o.id === f.opId)?.status).toBe("intent");
  });
});

/**
 * The real route handlers and server components, with a signed session
 * cookie. Only the database, the escrow provider (the in-memory fake) and
 * Horizon (a fetch stub) are swapped. The caps are set in the environment to
 * values that are not the defaults, so a page or a message that shows 3 and
 * 250 read them from there.
 */
describe("caps and readiness through the routes and pages", () => {
  const HORIZON = "https://horizon-testnet.stellar.org";
  const ORIGIN = "https://proofwork.test";

  /** What Horizon answers for the funder's account in this test, and every URL it was asked for. */
  let horizon: () => FakeReply;
  let asked: string[];

  beforeEach(async () => {
    // A fresh environment and fresh modules for every test: nothing an earlier test loaded or cached
    // (the parsed environment, the in-memory rate limiter) carries into the routes and pages below.
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
    vi.stubEnv("FUNDER_MAX_OPEN_CAMPAIGNS", "3");
    vi.stubEnv("FUNDER_MAX_OPEN_BUDGET", "250");

    asked = [];
    horizon = () => ({ status: 200, body: horizonAccount("1000.0000000") });
    // Only the funder's account may be read: any other request fails the test that made it.
    vi.stubGlobal(
      "fetch",
      horizonAccountsOnly((url) => {
        asked.push(url);
        return horizon();
      }),
    );
    await changeRole({ pubkey: FUNDER, role: "funder", action: "grant" }, { via: "script" }, conn);
    const { encodeSession } = await import("@/lib/session");
    world.jar.set("pw_session", encodeSession(FUNDER));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const post = (path: string, body: unknown) =>
    new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const forCampaign = (id: string) => ({ params: Promise.resolve({ id }) });
  const body = (budget: string) => ({ ...base, title: "Launch week", budget });

  async function createCall(budget: string): Promise<Response> {
    const { POST } = await import("@/app/api/campaigns/route");
    return POST(post("/api/campaigns", body(budget)));
  }

  async function escrowCall(id: string, payload: unknown): Promise<Response> {
    const { POST } = await import("@/app/api/campaigns/[id]/escrow/route");
    return POST(post(`/api/campaigns/${id}/escrow`, payload), forCampaign(id));
  }

  async function payoutsCall(id: string, payload: unknown): Promise<Response> {
    const { POST } = await import("@/app/api/campaigns/[id]/payouts/route");
    return POST(post(`/api/campaigns/${id}/payouts`, payload), forCampaign(id));
  }

  async function created(budget: string): Promise<{ id: string; slug: string }> {
    const res = await createCall(budget);
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; slug: string };
  }

  async function escrowStep(id: string, kind: "deploy" | "fund"): Promise<void> {
    const prepared = await escrowCall(id, { action: "prepare", kind });
    expect(prepared.status).toBe(200);
    const { opId, unsignedXdr } = (await prepared.json()) as { opId: string; unsignedXdr: string };
    expect((await escrowCall(id, { action: "submit", kind, opId, signedXdr: unsignedXdr })).status).toBe(200);
  }

  async function newCampaignPage(): Promise<string> {
    const { default: Page } = await import("@/app/(workspace)/campaigns/new/page");
    return renderToStaticMarkup((await Page()) as ReactElement);
  }

  async function campaignPage(slug: string): Promise<string> {
    const { default: Page } = await import("@/app/(workspace)/campaigns/[slug]/page");
    return renderToStaticMarkup((await Page({ params: Promise.resolve({ slug }) })) as ReactElement);
  }

  const disabled = (html: string, label: string) => new RegExp(`<button[^>]*disabled=""[^>]*>${label}`).test(html);

  it("the new-campaign page shows both limits and the current usage, from the environment", async () => {
    const empty = await newCampaignPage();
    expect(empty).toContain("0 of 3 in use");
    expect(empty).toContain("0 USDC of 250 USDC in use, 250 USDC left");
    expect(empty).toContain("A campaign starts to count when its escrow is deployed and stops when it is closed.");
    expect(empty).toContain("be created while a limit is reached");
    expect(empty).not.toContain("Drafts do not count");

    const { id } = await created("40");
    // A draft counts for nothing until its escrow is deployed.
    expect(await newCampaignPage()).toContain("0 of 3 in use");
    await escrowStep(id, "deploy");
    const html = await newCampaignPage();
    expect(html).toContain("1 of 3 in use");
    expect(html).toContain("40 USDC of 250 USDC in use, 210 USDC left");
    expect(disabled(html, "Save campaign")).toBe(false);
  });

  it("a refused create answers 409 with the environment's limit in the message and stores nothing", async () => {
    const res = await createCall("300");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "CONFLICT",
      message: "open-budget limit exceeded: this wallet has 0 of 250 USDC in use, which leaves no room for a 300 USDC campaign",
    });
    expect(await campaignRows()).toHaveLength(0);
    // Above the default of 100 and under the configured 250.
    expect((await createCall("150")).status).toBe(200);
  });

  it("at the campaign cap the page says so, the form is off and the routes refuse create and deploy", async () => {
    const spare = await created("10");
    for (let i = 0; i < 3; i++) await escrowStep((await created("10")).id, "deploy");

    const html = await newCampaignPage();
    expect(html).toContain("3 of 3 in use");
    expect(html).toContain("You have reached the open-campaign limit, so a new campaign can&#x27;t be created.");
    expect(disabled(html, "Save campaign")).toBe(true);

    const create = await createCall("10");
    expect(create.status).toBe(409);
    expect(await create.json()).toMatchObject({ message: expect.stringContaining("3 of 3 open campaigns") });

    const deployRes = await escrowCall(spare.id, { action: "prepare", kind: "deploy" });
    expect(deployRes.status).toBe(409);
    expect(await deployRes.json()).toMatchObject({ error: "CONFLICT", message: expect.stringContaining("3 of 3 open campaigns") });
    expect((await opRows()).filter((o) => o.campaignId === spare.id)).toEqual([]);
    expect(await campaignRows()).toHaveLength(4);
  });

  it("reads the session wallet at the configured Horizon host, once for the page and once for the deploy", async () => {
    const { id, slug } = await created("50");
    const html = await campaignPage(slug);
    expect(asked).toEqual([`${HORIZON}/accounts/${FUNDER}`]);
    expect(html).toContain("Ready");
    expect(html).toContain("1000 USDC to spend");
    expect(disabled(html, "1 · Deploy escrow")).toBe(false);

    expect((await escrowCall(id, { action: "prepare", kind: "deploy" })).status).toBe(200);
    expect(asked).toEqual([`${HORIZON}/accounts/${FUNDER}`, `${HORIZON}/accounts/${FUNDER}`]);
  });

  it("not ready: the campaign page lists every missing item at once and the deploy button is off", async () => {
    horizon = () => ({ status: 404, body: { status: 404 } });
    const { id, slug } = await created("50");
    const html = await campaignPage(slug);
    expect(html).toContain("Not ready");
    expect(html).toContain("The account does not exist on Stellar testnet yet.");
    expect(html).toContain("The account has no USDC trustline.");
    expect(html).toContain("The wallet has 0 USDC to spend and the budget is 50 USDC.");
    expect(html).toContain("The wallet has 0 XLM free for network fees and needs 1.5 XLM, 0.5 XLM of it for the reserve the USDC trustline will hold.");
    expect(html).toContain(`href="${USDC_FAUCET_URL}"`);
    expect(html).toContain("Activate testnet account");
    expect(html).toContain("Check again");
    expect(disabled(html, "1 · Deploy escrow")).toBe(true);

    const res = await escrowCall(id, { action: "prepare", kind: "deploy" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CONFLICT", message: expect.stringContaining("not ready to deploy the escrow") });
    expect(await opRows()).toEqual([]);
  });

  it("short of USDC after deploy: the page shows balance and budget and the fund is refused", async () => {
    const { id, slug } = await created("50");
    await escrowStep(id, "deploy");
    horizon = () => ({ status: 200, body: horizonAccount("12.5000000") });
    const html = await campaignPage(slug);
    expect(html).toContain("The wallet has 12.5 USDC to spend and the budget is 50 USDC.");
    expect(html).not.toContain("no USDC trustline");
    expect(disabled(html, "2 · Fund budget")).toBe(true);

    const res = await escrowCall(id, { action: "prepare", kind: "fund" });
    expect(res.status).toBe(409);
    expect((await opRows()).filter((o) => o.kind === "fund")).toEqual([]);
  });

  it("Horizon down: the page shows the wallet as not checked with a retry, and deploy answers 502 with a try-again message", async () => {
    // The logger the routes use, loaded after this test's module reset.
    const warn = vi.spyOn((await import("@/lib/logger")).log, "warn").mockImplementation(() => undefined);
    horizon = () => ({ status: 503, body: {} });
    const { id, slug } = await created("50");
    const html = await campaignPage(slug);
    expect(html).toContain("Not checked");
    expect(html).toContain("Deploy and fund stay off until it has.");
    expect(html).toContain("Retry");
    expect(disabled(html, "1 · Deploy escrow")).toBe(true);

    const res = await escrowCall(id, { action: "prepare", kind: "deploy" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "LEDGER", message: "couldn't check your wallet on Stellar, try again" });
    expect(await opRows()).toEqual([]);
    expect(warn).toHaveBeenCalledWith("funder wallet read failed", expect.objectContaining({ wallet: FUNDER, err: "Horizon answered 503" }));
  });

  it("a fund already sent keeps its button on while the wallet reads as short, so the escrow can be read", async () => {
    const { id, slug } = await created("50");
    await escrowStep(id, "deploy");
    const prepared = await escrowCall(id, { action: "prepare", kind: "fund" });
    const { opId, unsignedXdr } = (await prepared.json()) as { opId: string; unsignedXdr: string };
    await escrow.submit(unsignedXdr);
    await conn.update(escrowOps).set({ status: "submitted", updatedAt: new Date(Date.now() - STALE_SUBMITTED_MS - 1000) }).where(eq(escrowOps.id, opId));
    horizon = () => ({ status: 200, body: horizonAccount("0.0000000") });

    const html = await campaignPage(slug);
    expect(html).toContain("Not ready");
    expect(html).toContain("A fund transaction was already sent for this campaign, so the Fund budget button stays on.");
    expect(html).toContain("Pressing it reads the escrow");
    expect(disabled(html, "2 · Fund budget")).toBe(false);
    // Nothing was ever "not sent" here, so the campaign cannot be abandoned.
    expect(html).not.toContain("Abandon this campaign");
    expect((await escrowCall(id, { action: "abandon" })).status).toBe(409);

    // The same when Horizon cannot answer: the panel must not say the fund stays off beside a button that is on.
    vi.spyOn((await import("@/lib/logger")).log, "warn").mockImplementation(() => undefined);
    horizon = () => ({ status: 503, body: {} });
    const unchecked = await campaignPage(slug);
    expect(unchecked).toContain("Not checked");
    expect(unchecked).toContain("so the Fund budget button stays on.");
    expect(unchecked).not.toContain("Deploy and fund stay off");
    expect(disabled(unchecked, "2 · Fund budget")).toBe(false);
    horizon = () => ({ status: 200, body: horizonAccount("0.0000000") });

    const res = await escrowCall(id, { action: "prepare", kind: "fund" });
    expect(await res.json()).toMatchObject({ error: "CONFLICT", message: expect.stringContaining("fund already confirmed") });
    expect((await campaignRow(id)).fundedAt).toBeInstanceOf(Date);
  });

  it("a draft that does not fit under the limits says so on its page and keeps deploy off, although the wallet is ready", async () => {
    const spare = await created("10");
    for (let i = 0; i < 3; i++) await escrowStep((await created("10")).id, "deploy");

    const html = await campaignPage(spare.slug);
    expect(html).toContain("Ready");
    expect(html).toContain("be deployed while a limit is reached: open-campaign limit reached: this wallet has 3 of 3 open campaigns in use, close one first.");
    expect(disabled(html, "1 · Deploy escrow")).toBe(true);

    // A draft that fits shows no such line and can deploy.
    const closing = (await campaignRows()).find((c) => c.escrowContractId !== null);
    if (!closing) throw new Error("no deployed campaign");
    expect((await escrowCall(closing.id, { action: "abandon" })).status).toBe(200);
    const fits = await campaignPage(spare.slug);
    expect(fits).not.toContain("while a limit is reached:");
    expect(disabled(fits, "1 · Deploy escrow")).toBe(false);
  });

  it("the budget limit shows on the draft page as well", async () => {
    const big = await created("200");
    await escrowStep((await created("100")).id, "deploy");
    const html = await campaignPage(big.slug);
    expect(html).toContain("open-budget limit exceeded: this wallet has 100 of 250 USDC in use, which leaves no room for a 200 USDC campaign.");
    expect(disabled(html, "1 · Deploy escrow")).toBe(true);
  });

  it("deploys prepared while under the cap: the fourth signed deploy is refused at submit and never sent", async () => {
    const drafts = [await created("10"), await created("10"), await created("10"), await created("10")];
    const prepared = [];
    for (const d of drafts) {
      const res = await escrowCall(d.id, { action: "prepare", kind: "deploy" });
      expect(res.status).toBe(200);
      prepared.push({ id: d.id, ...((await res.json()) as { opId: string; unsignedXdr: string }) });
    }
    const statuses = [];
    for (const p of prepared) {
      statuses.push((await escrowCall(p.id, { action: "submit", kind: "deploy", opId: p.opId, signedXdr: p.unsignedXdr })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 409]);
    expect(escrow.submits).toBe(3);
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 3, openBudget: "30" });
  });

  it("the fund step needs the fee of one transaction: 0.7 XLM free after deploy is ready, with the fund button on", async () => {
    const { id, slug } = await created("50");
    await escrowStep(id, "deploy");
    // 2.2 XLM with one subentry: 1.5 XLM of reserve, 0.7 XLM free. Short of the 1 XLM a deploy needs, enough for a fund.
    horizon = () => ({ status: 200, body: horizonAccount("50.0000000", "2.2000000") });
    const html = await campaignPage(slug);
    expect(html).toContain("Ready");
    expect(html).toContain("This wallet can fund the budget: 50 USDC to spend and 0.7 XLM free for network fees.");
    expect(disabled(html, "2 · Fund budget")).toBe(false);
    expect((await escrowCall(id, { action: "prepare", kind: "fund" })).status).toBe(200);

    // The same wallet on a draft is short: deploy needs the fees of two transactions.
    const other = await created("50");
    const draftPage = await campaignPage(other.slug);
    expect(draftPage).toContain("The wallet has 0.7 XLM free for network fees and needs 1 XLM.");
    expect(disabled(draftPage, "1 · Deploy escrow")).toBe(true);
  });

  it("the form's open-budget block: budget used up with a campaign slot free says so and Save is off", async () => {
    await escrowStep((await created("250")).id, "deploy");
    const html = await newCampaignPage();
    expect(html).toContain("1 of 3 in use");
    expect(html).toContain("250 USDC of 250 USDC in use");
    expect(html).not.toContain("USDC left");
    expect(html).toContain("You have reached the open-budget limit, so a new campaign can&#x27;t be created.");
    expect(html).not.toContain("open-campaign limit");
    expect(disabled(html, "Save campaign")).toBe(true);
  });

  it("a deployed campaign that was never funded can be abandoned from its page, and that frees the cap", async () => {
    const { id, slug } = await created("250");
    await escrowStep(id, "deploy");
    const html = await campaignPage(slug);
    expect(html).toContain("Abandon this campaign instead");
    expect((await createCall("10")).status).toBe(409);

    const submits = escrow.submits;
    const res = await escrowCall(id, { action: "abandon" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ closedAt: expect.any(String) });
    expect(escrow.submits).toBe(submits);
    expect((await campaignRow(id)).closedAt).toBeInstanceOf(Date);
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 0, openBudget: "0" });
    expect((await createCall("10")).status).toBe(200);

    // Closed: no escrow controls, and neither fund step is served.
    const after = await campaignPage(slug);
    expect(after).toContain(">closed<");
    expect(after).not.toContain("2 · Fund budget");
    expect(after).not.toContain("Abandon this campaign");
    const fundRes = await escrowCall(id, { action: "prepare", kind: "fund" });
    expect(fundRes.status).toBe(409);
    expect(await fundRes.json()).toMatchObject({ message: "campaign is closed" });
  });

  it("abandon is refused for a funded campaign, a draft, another wallet, and a wallet without the funder role", async () => {
    const draftOne = await created("10");
    expect((await escrowCall(draftOne.id, { action: "abandon" })).status).toBe(409);
    expect((await campaignPage(draftOne.slug))).not.toContain("Abandon this campaign");

    const { id, slug } = await created("50");
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    const funded = await escrowCall(id, { action: "abandon" });
    expect(funded.status).toBe(409);
    expect(await funded.json()).toMatchObject({ message: expect.stringContaining("campaign is funded") });
    expect(await campaignPage(slug)).not.toContain("Abandon this campaign");

    const deployedOnly = await created("10");
    await escrowStep(deployedOnly.id, "deploy");
    const { encodeSession } = await import("@/lib/session");
    const stranger = Keypair.random().publicKey();
    world.jar.set("pw_session", encodeSession(stranger));
    expect((await escrowCall(deployedOnly.id, { action: "abandon" })).status).toBe(403);
    await changeRole({ pubkey: stranger, role: "funder", action: "grant" }, { via: "script" }, conn);
    expect((await escrowCall(deployedOnly.id, { action: "abandon" })).status).toBe(403);
    expect((await campaignRow(deployedOnly.id)).closedAt).toBeNull();
  });

  it("a funded campaign with no submissions shows Close campaign, enabled", async () => {
    const { id, slug } = await created("50");
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    const html = await campaignPage(slug);
    expect(html).toContain("No submissions yet.");
    expect(html).toContain("Close campaign");
    expect(disabled(html, "Close campaign")).toBe(false);

    const prepared = await payoutsCall(id, { action: "prepare", kind: "close" });
    expect(prepared.status).toBe(200);
    const op = ((await prepared.json()) as { ops: Array<{ opId: string; unsignedXdr: string }> }).ops[0];
    if (!op) throw new Error("no close prepared");
    expect((await payoutsCall(id, { action: "submit", kind: "close", opId: op.opId, signedXdr: op.unsignedXdr })).status).toBe(200);
    const closedPage = await campaignPage(slug);
    expect(closedPage).not.toContain("Close campaign");
  });

  it("saving a campaign is limited per wallet: the 21st in ten minutes answers 429 and stores nothing", async () => {
    for (let i = 0; i < 20; i++) expect((await createCall("10")).status).toBe(200);
    const res = await createCall("10");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(await campaignRows()).toHaveLength(20);

    // Another wallet has its own count.
    const { encodeSession } = await import("@/lib/session");
    const other = Keypair.random().publicKey();
    await changeRole({ pubkey: other, role: "funder", action: "grant" }, { via: "script" }, conn);
    world.jar.set("pw_session", encodeSession(other));
    expect((await createCall("10")).status).toBe(200);
  });

  it("asking for an escrow transaction is limited per wallet: the 31st prepare answers 429 without reading Horizon", async () => {
    horizon = () => ({ status: 200, body: horizonAccount("0.0000000") });
    const { id } = await created("50");
    for (let i = 0; i < 30; i++) expect((await escrowCall(id, { action: "prepare", kind: "deploy" })).status).toBe(409);
    expect(asked).toHaveLength(30);
    const res = await escrowCall(id, { action: "prepare", kind: "deploy" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "RATE_LIMITED" });
    expect(asked).toHaveLength(30);
    // Submit and abandon are not counted against it.
    expect((await escrowCall(id, { action: "abandon" })).status).toBe(409);
  });

  it("a funded campaign whose funder is over both caps and not ready still approves, releases and closes, and the wallet is never read", async () => {
    const { id, slug } = await created("100");
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    // Three more open campaigns of 100 each: 4 of 3 campaigns and 400 of 250 USDC.
    for (let i = 0; i < 3; i++) {
      await conn.insert(campaigns).values({
        id: `cmp_over_${i}`,
        slug: `over-${i}`,
        title: "Over the cap",
        brief: "A brief long enough to pass validation.",
        rewardAmount: "10",
        budget: "100",
        deadlineAt: new Date(Date.now() + 86_400_000),
        funderPubkey: FUNDER,
        disputeResolverPubkey: base.disputeResolverPubkey,
        escrowContractId: `C_OVER_${i}`,
      });
    }
    expect(await funderUsage(FUNDER, conn)).toEqual({ openCampaigns: 4, openBudget: "400" });
    expect((await createCall("10")).status).toBe(409);

    await conn.insert(submissions).values({ id: "sub_1", shortId: "s1", campaignId: id, contributorPubkey: Keypair.random().publicKey(), workUrl: "https://x.com/a/status/1", status: "decided" });
    await conn.insert(decisions).values({
      id: "dec_1",
      submissionId: "sub_1",
      reviewerPubkey: Keypair.random().publicKey(),
      outcome: "PASS",
      reasonCode: "R00_PASS",
      signals: {},
      note: "",
      canonicalJson: "{}",
      decisionHash: "h",
      ledgerKey: "pw:s1",
    });

    // From here the wallet has no account at all, and nothing below may ask.
    horizon = () => ({ status: 404, body: { status: 404 } });
    asked = [];

    const html = await campaignPage(slug);
    expect(html).toContain("Submissions and payouts");
    expect(html).not.toContain("Wallet readiness");

    expect((await payoutsCall(id, { action: "approve", submissionIds: ["sub_1"] })).status).toBe(200);
    for (const kind of ["release", "close"] as const) {
      const prepared = await payoutsCall(id, { action: "prepare", kind });
      expect(prepared.status).toBe(200);
      const op = ((await prepared.json()) as { ops: Array<{ opId: string; unsignedXdr: string }> }).ops[0];
      if (!op) throw new Error(`no ${kind} prepared`);
      expect((await payoutsCall(id, { action: "submit", kind, opId: op.opId, signedXdr: op.unsignedXdr })).status).toBe(200);
    }
    expect((await conn.select().from(payouts))[0]).toMatchObject({ status: "released" });
    expect((await campaignRow(id)).closedAt).toBeInstanceOf(Date);
    expect(asked).toEqual([]);
  });
});
