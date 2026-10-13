import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";
import { confirmClose, prepareClose } from "@/services/payout";
import { recordSweep, RemainderError, returnRemainder } from "@/services/remainder";
import { makeTestDb } from "./db";
import { LIMITS, openGate } from "./funder-wallet";

const CAMPAIGN = "cmp_1";
const HASH = "a".repeat(64);
const resolver = Keypair.random();
const funderKey = Keypair.random();
const FUNDER = funderKey.publicKey();
const actor = { pubkey: FUNDER, platformAdmin: "G_ADMIN", platformOps: "G_OPS" };

let conn: Db;
let close: () => Promise<void>;
let escrow: FakeEscrow;
let said: string[];
const say = (line: string) => void said.push(line);

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  escrow = new FakeEscrow();
  said = [];
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "camp-1",
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "10",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: FUNDER,
    disputeResolverPubkey: resolver.publicKey(),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

/** Deploy and fund through the services, as the funder's wallet would. */
async function funded(): Promise<string> {
  const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
  const { contractId } = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn);
  const f = await prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn);
  await confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn);
  return contractId;
}

/** Funded, then closed by its funder in the app: the close milestone is disputed and the row is closed. */
async function closed(): Promise<string> {
  const contractId = await funded();
  const c = await prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
  await confirmClose({ campaignId: CAMPAIGN, opId: c.opId, signedXdr: c.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
  return contractId;
}

/** An escrow no campaign row knows: deployed and funded straight on the provider. */
async function outsideTheApp(funder: string): Promise<string> {
  const roles = { funder, platformAdmin: "G_ADMIN", platformOps: "G_OPS", disputeResolver: resolver.publicKey() };
  const d = await escrow.buildDeploy({ engagementId: "outside", title: "t", description: "d", signer: funder, roles, closeMilestone: { description: "close", amount: "0.0000001" } });
  const { contractId } = await escrow.submit(d.unsignedXdr);
  if (!contractId) throw new Error("no contract");
  await escrow.submit((await escrow.buildFund(contractId, funder, "40")).unsignedXdr);
  return contractId;
}

const sweep = (contractId: string, db: Db | null = conn, ownFunder: Keypair | null = null) =>
  returnRemainder({ contractId, signers: { resolver, ownFunder }, say }, escrow, db);
const row = async () => (await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0];
const balance = async (contractId: string) => (await escrow.getEscrow(contractId)).balance;
/** The hash the flow said before it sent the sweep. */
const saidHash = () => said.map((l) => /^withdraw remaining → funder: ([0-9a-f]{64}) /.exec(l)?.[1]).find((h) => h !== undefined);

describe("returnRemainder", () => {
  it("sweeps the whole balance to the escrow's funder and records the hash it said before sending", async () => {
    const contractId = await closed();
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    const result = await sweep(contractId);
    expect(result).toEqual({ outcome: "swept", txHash: saidHash(), recorded: true });
    expect(withdraw).toHaveBeenCalledWith(contractId, resolver.publicKey(), [{ address: FUNDER, amount: "100" }]);
    expect(await balance(contractId)).toBe("0");
    expect((await row())?.remainderTxHash).toBe(saidHash());
    expect(said.indexOf(`balance after: 0 USDC`)).toBeGreaterThan(said.findIndex((l) => l.startsWith("withdraw remaining")));
  });

  it("an escrow the database does not know is refused before any submit", async () => {
    const contractId = await outsideTheApp(FUNDER);
    await escrow.submit(((await escrow.buildDispute(contractId, FUNDER, [0]))[0] ?? { unsignedXdr: "" }).unsignedXdr);
    const before = escrow.submits;
    await expect(sweep(contractId)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/no campaign with this escrow/) });
    expect(escrow.submits).toBe(before);
    expect(await balance(contractId)).toBe("40");
  });

  it("a campaign whose funder differs from the escrow's is refused before any submit", async () => {
    const contractId = await closed();
    await conn.update(campaigns).set({ funderPubkey: "G_SOMEONE_ELSE" });
    const before = escrow.submits;
    await expect(sweep(contractId)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/another funder/) });
    expect(escrow.submits).toBe(before);
    expect((await row())?.remainderTxHash).toBeNull();
  });

  it("a campaign still open in the app is refused, also when the funder's own key is at hand", async () => {
    const contractId = await funded();
    const before = escrow.submits;
    await expect(sweep(contractId, conn, funderKey)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/not closed in the app/) });
    expect(escrow.submits).toBe(before);
    expect((await escrow.getEscrow(contractId)).milestones[0]?.disputed).toBe(false);
  });

  it("a campaign that already has a remainder hash while the escrow holds money is refused before any submit", async () => {
    const contractId = await closed();
    await conn.update(campaigns).set({ remainderTxHash: HASH });
    const before = escrow.submits;
    await expect(sweep(contractId)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/already has remainder/) });
    expect(escrow.submits).toBe(before);
    expect(await balance(contractId)).toBe("100");
    expect((await row())?.remainderTxHash).toBe(HASH);
  });

  it("a resolver key that is not the escrow's, and an open reward milestone, are refused", async () => {
    const contractId = await closed();
    await expect(returnRemainder({ contractId, signers: { resolver: Keypair.random() }, say }, escrow, conn)).rejects.toMatchObject({ kind: "refused" });
    await escrow.appendMilestones(contractId, [{ description: "s1 x", amount: "10", receiver: "G_C1" }]);
    await expect(sweep(contractId)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/milestones still open: 1/) });
    expect(await balance(contractId)).toBe("100");
  });

  it("a sweep accepted without effect throws and records nothing", async () => {
    const contractId = await closed();
    escrow.failNextSubmit("accept-without-effect");
    await expect(sweep(contractId)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/still holds 100 USDC after [0-9a-f]{64}; nothing was recorded/) });
    expect((await row())?.remainderTxHash).toBeNull();
  });

  it("a sweep that landed while its reply was lost is recorded under the hash taken before sending", async () => {
    const contractId = await closed();
    escrow.failNextSubmit("landed-then-throw");
    const result = await sweep(contractId);
    expect(result).toEqual({ outcome: "swept", txHash: saidHash(), recorded: true });
    expect(saidHash()).toMatch(/^[0-9a-f]{64}$/);
    expect((await row())?.remainderTxHash).toBe(saidHash());
  });

  it("a submit that failed without landing is thrown as it came and records nothing", async () => {
    const contractId = await closed();
    escrow.failNextSubmit("throw");
    await expect(sweep(contractId)).rejects.toThrow("send-transaction timed out");
    expect(await balance(contractId)).toBe("100");
    expect((await row())?.remainderTxHash).toBeNull();
  });

  it("an accepted sweep whose escrow cannot be read afterwards is reported with its hash and not recorded", async () => {
    const contractId = await closed();
    const real = escrow.getEscrow.bind(escrow);
    let reads = 0;
    vi.spyOn(escrow, "getEscrow").mockImplementation(async (id) => {
      reads += 1;
      if (reads > 1) throw new Error("read timed out");
      return real(id);
    });
    const failure = await sweep(contractId).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RemainderError);
    expect(failure).toMatchObject({ kind: "swept_unrecorded", txHash: saidHash() });
    expect((await row())?.remainderTxHash).toBeNull();
  });

  it("a sweep that landed but could not be written is reported with its hash", async () => {
    const contractId = await closed();
    // Reads work; the write of the hash does not.
    const readOnly = new Proxy(conn, {
      get(target, prop) {
        if (prop === "update") return () => { throw new Error("database went away"); };
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const failure = await sweep(contractId, readOnly).catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: "swept_unrecorded", txHash: saidHash(), message: expect.stringMatching(/landed but could not be recorded/) });
    expect(await balance(contractId)).toBe("0");
    expect((await row())?.remainderTxHash).toBeNull();
  });

  it("without a database it sweeps and records nothing", async () => {
    const contractId = await closed();
    const result = await sweep(contractId, null);
    expect(result).toEqual({ outcome: "swept", txHash: saidHash(), recorded: false });
    expect(saidHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(await balance(contractId)).toBe("0");
    expect((await row())?.remainderTxHash).toBeNull();
  });

  it("an empty escrow: recorded hash is reported, a missing one is an error, and without a database it is just empty", async () => {
    const contractId = await closed();
    await sweep(contractId, null);
    const before = escrow.submits;
    await expect(sweep(contractId)).rejects.toMatchObject({ kind: "empty_unrecorded" });
    await expect(sweep(contractId, null)).resolves.toEqual({ outcome: "nothing", recordedTxHash: null });
    await conn.update(campaigns).set({ remainderTxHash: HASH });
    await expect(sweep(contractId)).resolves.toEqual({ outcome: "nothing", recordedTxHash: HASH });
    expect(escrow.submits).toBe(before);
  });

  it("a campaign abandoned without ever being funded has nothing to sweep and nothing missing", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    const { contractId } = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn);
    await conn.update(campaigns).set({ closedAt: new Date() });
    const before = escrow.submits;
    await expect(sweep(contractId)).resolves.toEqual({ outcome: "nothing", recordedTxHash: null });
    expect(escrow.submits).toBe(before);
  });

  it("an escrow funded outside the app is disputed with the funder's own key only when that key is given", async () => {
    const contractId = await outsideTheApp(FUNDER);
    await expect(sweep(contractId, null)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/close milestone not disputed yet/) });
    await expect(sweep(contractId, null, Keypair.random())).rejects.toMatchObject({ kind: "refused" });
    expect(await balance(contractId)).toBe("40");
    await expect(sweep(contractId, null, funderKey)).resolves.toMatchObject({ outcome: "swept", recorded: false });
    expect(await balance(contractId)).toBe("0");
  });
});

describe("recordSweep", () => {
  const record = (contractId: string, txHash = HASH) => recordSweep({ contractId, txHash, say }, escrow, conn);

  it("records a sweep made without the database, once the escrow reads empty, and signs nothing", async () => {
    const contractId = await closed();
    await expect(record(contractId)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/still holds 100 USDC/) });
    expect((await row())?.remainderTxHash).toBeNull();
    const { txHash } = (await sweep(contractId, null)) as { txHash: string };
    const before = escrow.submits;
    await expect(record(contractId, txHash)).resolves.toMatchObject({ id: CAMPAIGN, remainderTxHash: txHash });
    expect(escrow.submits).toBe(before);
    expect((await row())?.remainderTxHash).toBe(txHash);
  });

  it("refuses another hash once one is recorded, a malformed hash, and an escrow the database does not know", async () => {
    const contractId = await closed();
    await sweep(contractId);
    await expect(record(contractId, "b".repeat(64))).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/already recorded/) });
    await expect(record(contractId, "nope")).rejects.toMatchObject({ kind: "refused" });
    const other = await outsideTheApp(FUNDER);
    await escrow.submit(((await escrow.buildDispute(other, FUNDER, [0]))[0] ?? { unsignedXdr: "" }).unsignedXdr);
    await escrow.submit((await escrow.buildWithdrawRemaining(other, resolver.publicKey(), [{ address: FUNDER, amount: "40" }])).unsignedXdr);
    await expect(record(other)).rejects.toMatchObject({ kind: "refused", message: expect.stringMatching(/no campaign with this escrow/) });
  });
});
