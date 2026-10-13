import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { and, desc, eq, inArray, isNotNull, isNull, notExists } from "drizzle-orm";
import { z } from "zod";
import { env, type FunderLimits } from "@/config/env";
import { db, type Db } from "@/db/client";
import { campaigns, escrowOps, type Campaign, type EscrowOp } from "@/db/schema";
import { assessFunding, describeMissing, type FundingReadiness, type FundingStep } from "@/domain/funding-readiness";
import { assertPositiveAmount, fromStroops, toStroops } from "@/escrow/amount";
import type { EscrowPort, Submitted } from "@/escrow/port";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { readFunderAccount, type FunderAccount } from "@/wallet/onboarding";
import { campaignOwnedBy, findOp, prepareOp, submitOp, type OnConfirmed, type PreparedOp, type Verify } from "./escrow-ops";

const CLOSE_MILESTONE_AMOUNT = "0.0000001";
const MAX_REWARDS = 49n;

const amount = z.string().trim().refine((v) => {
  try {
    assertPositiveAmount(v);
    return true;
  } catch {
    return false;
  }
}, "must be a positive USDC amount with at most 7 decimals");

export const createCampaignSchema = z
  .object({
    title: z.string().trim().min(3).max(100),
    brief: z.string().trim().min(20).max(4000),
    rewardAmount: amount,
    budget: amount,
    deadlineAt: z.coerce.date().refine((d) => d.getTime() > Date.now() + 60 * 60 * 1000, "deadline must be at least one hour away"),
    disputeResolverPubkey: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "invalid public key"),
  })
  .refine((c) => toStroops(c.budget) >= toStroops(c.rewardAmount), { message: "budget must cover at least one reward", path: ["budget"] })
  // Escrow holds 50 milestones: the close milestone plus 49 rewards. Bigint division floors.
  .refine((c) => {
    const reward = toStroops(c.rewardAmount);
    // A zero reward is already reported by the field refine.
    return reward === 0n || toStroops(c.budget) / reward <= MAX_REWARDS;
  }, {
    message: "budget covers more than 49 rewards; the escrow holds 49 reward milestones",
    path: ["budget"],
  });

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "campaign"}-${newId("").slice(1, 7).toLowerCase()}`;
}

/** What a funder has open: campaigns whose escrow is deployed and that are not closed. */
export interface FunderUsage {
  openCampaigns: number;
  /** Sum of their budgets, a USDC decimal string. */
  openBudget: string;
}

/**
 * A campaign counts from the moment its escrow is deployed until it is
 * closed. A draft without an escrow counts for nothing, so an abandoned draft
 * never blocks its funder.
 */
export async function funderUsage(pubkey: string, conn: Db = db): Promise<FunderUsage> {
  const open = await conn
    .select({ budget: campaigns.budget })
    .from(campaigns)
    .where(and(eq(campaigns.funderPubkey, pubkey), isNotNull(campaigns.escrowContractId), isNull(campaigns.closedAt)));
  return { openCampaigns: open.length, openBudget: fromStroops(open.reduce((sum, c) => sum + toStroops(c.budget), 0n)) };
}

/**
 * The refusal for a campaign of `budget` that does not fit under the funder's
 * caps, or null when it fits. The message names each cap it breaks, with the
 * limit and what is in use now.
 */
export async function limitRefusal(pubkey: string, budget: string, limits: FunderLimits, conn: Db = db): Promise<AppError | null> {
  const usage = await funderUsage(pubkey, conn);
  const refusals: string[] = [];
  const caps: Array<{ cap: "open_campaigns" | "open_budget"; limit: string; used: string }> = [];
  if (usage.openCampaigns + 1 > limits.maxOpenCampaigns) {
    refusals.push(`open-campaign limit reached: this wallet has ${usage.openCampaigns} of ${limits.maxOpenCampaigns} open campaigns in use, close one first`);
    caps.push({ cap: "open_campaigns", limit: String(limits.maxOpenCampaigns), used: String(usage.openCampaigns) });
  }
  if (toStroops(usage.openBudget) + toStroops(budget) > toStroops(limits.maxOpenBudget)) {
    refusals.push(
      `open-budget limit exceeded: this wallet has ${usage.openBudget} of ${limits.maxOpenBudget} USDC in use, which leaves no room for a ${fromStroops(toStroops(budget))} USDC campaign`,
    );
    caps.push({ cap: "open_budget", limit: limits.maxOpenBudget, used: usage.openBudget });
  }
  return refusals.length > 0 ? new AppError("CONFLICT", refusals.join("; "), { caps }) : null;
}

async function assertWithinLimits(pubkey: string, budget: string, limits: FunderLimits, conn: Db): Promise<void> {
  const refusal = await limitRefusal(pubkey, budget, limits, conn);
  if (refusal) throw refusal;
}

export async function createCampaign(
  input: CreateCampaignInput,
  actor: { pubkey: string; platformAdmin: string; platformOps: string },
  limits: FunderLimits,
  conn: Db = db,
): Promise<Campaign> {
  const taken = new Set([actor.platformAdmin, actor.platformOps, actor.pubkey]);
  if (taken.has(input.disputeResolverPubkey)) {
    throw AppError.validation("dispute resolver must be a neutral key, not the funder or a platform key");
  }
  // A new campaign is not created while a limit is reached. It starts to count only at deploy, where the caps are checked again.
  await assertWithinLimits(actor.pubkey, input.budget, limits, conn);
  const [row] = await conn
    .insert(campaigns)
    .values({
      id: newId("cmp"),
      slug: slugify(input.title),
      title: input.title,
      brief: input.brief,
      rewardAmount: input.rewardAmount,
      budget: input.budget,
      deadlineAt: input.deadlineAt,
      funderPubkey: actor.pubkey,
      disputeResolverPubkey: input.disputeResolverPubkey,
    })
    .returning();
  return row as Campaign;
}

export async function listCampaignsForFunder(pubkey: string, conn: Db = db): Promise<Campaign[]> {
  return conn.select().from(campaigns).where(eq(campaigns.funderPubkey, pubkey)).orderBy(desc(campaigns.createdAt));
}

export async function getCampaignBySlug(slug: string, conn: Db = db): Promise<Campaign | null> {
  return (await conn.select().from(campaigns).where(eq(campaigns.slug, slug)).limit(1))[0] ?? null;
}

export async function getCampaignById(id: string, conn: Db = db): Promise<Campaign | null> {
  return (await conn.select().from(campaigns).where(eq(campaigns.id, id)).limit(1))[0] ?? null;
}

/** Deploy is visible once the provider's contract id reads back with this campaign's engagement id. */
function deployVisible(escrow: EscrowPort, slug: string): Verify {
  return async (res: Submitted) => {
    if (!res.contractId) return false;
    return (await escrow.getEscrow(res.contractId)).engagementId === slug;
  };
}

/** Funding is visible once the escrow balance covers the budget. */
function fundVisible(escrow: EscrowPort, contractId: string | null, budget: string): Verify {
  return async () => {
    if (!contractId) return false;
    return toStroops((await escrow.getEscrow(contractId)).balance) >= toStroops(budget);
  };
}

/** Record the deployed contract id; the op carries it from the submit body. */
function deployConfirmed(campaignId: string, conn: Db): OnConfirmed {
  return async (op: EscrowOp) => {
    const contractId = (op.payload as { contractId?: string }).contractId;
    if (!contractId) throw new AppError("ESCROW", "deploy confirmed but no contract id was recorded", { txHash: op.txHash });
    await conn.update(campaigns).set({ escrowContractId: contractId }).where(and(eq(campaigns.id, campaignId), isNull(campaigns.escrowContractId)));
  };
}

function fundConfirmed(campaignId: string, conn: Db): OnConfirmed {
  return async () => {
    await conn.update(campaigns).set({ fundedAt: new Date() }).where(and(eq(campaigns.id, campaignId), isNull(campaigns.fundedAt)));
  };
}

/** Reads what a funder's wallet holds on Stellar. Injected so unit tests need no network. */
export type FunderAccountReader = (pubkey: string) => Promise<FunderAccount>;

/** Default reader: one Horizon read against the configured testnet host. `timeoutMs` shortens the wait for a page render. */
export function horizonFunderAccountReader(timeoutMs?: number): FunderAccountReader {
  return (pubkey) =>
    readFunderAccount(pubkey, { horizonUrl: env.HORIZON_URL, usdcIssuer: env.USDC_ISSUER, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
}

/**
 * Whether `pubkey` can pay for the next escrow transaction of a campaign with
 * this budget. A read that fails is logged and reported as `unchecked`, never
 * as ready.
 */
export async function fundingReadiness(pubkey: string, budget: string, step: FundingStep, account: FunderAccountReader): Promise<FundingReadiness> {
  let held: FunderAccount;
  // Only the read is caught: an error in the rules below is a bug, not Stellar failing to answer.
  try {
    held = await account(pubkey);
  } catch (e) {
    log.warn("funder wallet read failed", { wallet: pubkey, step, err: e instanceof Error ? e.message : String(e) });
    return { status: "unchecked" };
  }
  return assessFunding(held, budget, step);
}

/** Refuses to go on to building a transaction the wallet could not pay for, naming every missing item. */
async function assertReady(pubkey: string, budget: string, step: FundingStep, account: FunderAccountReader): Promise<void> {
  const readiness = await fundingReadiness(pubkey, budget, step, account);
  if (readiness.status === "unchecked") throw new AppError("LEDGER", "couldn't check your wallet on Stellar, try again");
  if (readiness.status === "not-ready") {
    const what = step === "deploy" ? "deploy the escrow" : "fund the budget";
    throw new AppError("CONFLICT", `your wallet is not ready to ${what}. ${readiness.missing.map(describeMissing).join(" ")}`, { missing: readiness.missing });
  }
}

/**
 * Step 1 of funding: build the deploy transaction for the funder's wallet.
 * The caps and the wallet are checked inside `build`, so they run only when a
 * transaction is about to be built and before any op row is written for it.
 * A deploy that is already confirmed is replayed by `prepareOp` before `build`
 * and never meets either check.
 */
export async function prepareDeploy(
  campaignId: string,
  actor: { pubkey: string; platformAdmin: string; platformOps: string },
  escrow: EscrowPort,
  gate: { limits: FunderLimits; account: FunderAccountReader },
  conn: Db = db,
): Promise<PreparedOp> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (c.escrowContractId) throw AppError.conflict("escrow already deployed");
  return prepareOp(
    {
      campaignId,
      kind: "deploy",
      keyParts: ["deploy", campaignId],
      build: async () => {
        // This campaign is not deployed yet, so it is added to what the funder's other campaigns use.
        await assertWithinLimits(actor.pubkey, c.budget, gate.limits, conn);
        await assertReady(actor.pubkey, c.budget, "deploy", gate.account);
        return escrow.buildDeploy({
          engagementId: c.slug,
          title: c.title,
          description: c.brief.slice(0, 500),
          signer: c.funderPubkey,
          roles: {
            funder: c.funderPubkey,
            platformAdmin: actor.platformAdmin,
            platformOps: actor.platformOps,
            disputeResolver: c.disputeResolverPubkey,
          },
          closeMilestone: { description: `campaign close · ${c.slug}`, amount: CLOSE_MILESTONE_AMOUNT },
        });
      },
      verify: deployVisible(escrow, c.slug),
      onConfirmed: deployConfirmed(campaignId, conn),
    },
    conn,
  );
}

export async function confirmDeploy(
  input: { campaignId: string; opId: string; signedXdr: string },
  actor: { pubkey: string },
  escrow: EscrowPort,
  limits: FunderLimits,
  conn: Db = db,
): Promise<{ txHash: string; contractId: string }> {
  const c = await campaignOwnedBy(input.campaignId, actor.pubkey, conn);
  // Deploys prepared for several drafts while under the caps must not all go out, so the caps are
  // checked again while this one is still unsent. An op past `intent` gets `submitOp`'s own answer.
  const op = await findOp(input.opId, input.campaignId, conn);
  if (op.status === "intent" && !c.escrowContractId) await assertWithinLimits(actor.pubkey, c.budget, limits, conn);
  const res = await submitOp({ ...input, expectedKind: "deploy", verify: deployVisible(escrow, c.slug) }, escrow, conn);
  if (!res.contractId) throw new AppError("ESCROW", "deploy confirmed but provider returned no contract id", { txHash: res.txHash });
  await deployConfirmed(input.campaignId, conn)(res.op);
  return { txHash: res.txHash, contractId: res.contractId };
}

/**
 * True when a fund transaction for this campaign has already gone to the
 * network: its op is past `intent`. The budget may be in the escrow while
 * `funded_at` is still empty, and only another prepare reconciles that.
 */
export async function fundSubmitted(campaignId: string, conn: Db = db): Promise<boolean> {
  const rows = await conn
    .select({ id: escrowOps.id })
    .from(escrowOps)
    .where(and(eq(escrowOps.campaignId, campaignId), eq(escrowOps.kind, "fund"), inArray(escrowOps.status, ["submitted", "failed", "confirmed"])))
    .limit(1);
  return rows.length > 0;
}

/**
 * Step 2 of funding: move the budget into escrow. The wallet is checked
 * inside `build`, which `prepareOp` reaches only after it has asked the chain
 * about a fund that was already sent. A fund that landed is confirmed there
 * and never meets the check: by then the budget has left the wallet, and the
 * wallet would read as short of USDC.
 */
export async function prepareFund(
  campaignId: string,
  actor: { pubkey: string },
  escrow: EscrowPort,
  account: FunderAccountReader,
  conn: Db = db,
): Promise<PreparedOp> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("deploy the escrow first");
  if (c.fundedAt) throw AppError.conflict("campaign already funded");
  if (c.closedAt) throw AppError.conflict("campaign is closed");
  const contractId = c.escrowContractId;
  return prepareOp(
    {
      campaignId,
      kind: "fund",
      keyParts: ["fund", campaignId],
      build: async () => {
        await assertReady(actor.pubkey, c.budget, "fund", account);
        return escrow.buildFund(contractId, c.funderPubkey, c.budget);
      },
      verify: fundVisible(escrow, contractId, c.budget),
      onConfirmed: fundConfirmed(campaignId, conn),
    },
    conn,
  );
}

export async function confirmFund(
  input: { campaignId: string; opId: string; signedXdr: string },
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<{ txHash: string }> {
  const c = await campaignOwnedBy(input.campaignId, actor.pubkey, conn);
  // An abandoned campaign takes no money, even through a fund that was prepared before it was abandoned.
  if (c.closedAt) throw AppError.conflict("campaign is closed");
  const res = await submitOp({ ...input, expectedKind: "fund", verify: fundVisible(escrow, c.escrowContractId, c.budget) }, escrow, conn);
  await fundConfirmed(input.campaignId, conn)(res.op);
  return { txHash: res.txHash };
}

/**
 * Gives up a campaign whose escrow was deployed and never funded, so that it
 * stops counting against its funder's caps. Allowed only while no fund
 * transaction was ever sent for it and the escrow itself, read through the
 * port, holds nothing: the app's records alone would miss a fund signed and
 * sent outside the app. Nothing is written to the chain. A closed campaign
 * cannot be funded afterwards (`prepareFund`, `confirmFund`).
 */
export async function abandonCampaign(campaignId: string, actor: { pubkey: string }, escrow: EscrowPort, conn: Db = db): Promise<Campaign> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("the escrow is not deployed, so there is nothing to abandon");
  if (c.closedAt) throw AppError.conflict("campaign already closed");
  if (c.fundedAt) throw AppError.conflict("campaign is funded; close it to return the budget");
  if (await fundSubmitted(campaignId, conn)) throw AppError.conflict("a fund transaction was sent for this campaign; finish funding it, then close it");
  let balance: string;
  try {
    balance = (await escrow.getEscrow(c.escrowContractId)).balance;
  } catch (e) {
    // Without the read nothing says the escrow is empty, so the campaign stays open.
    log.warn("escrow read failed before abandon", { campaignId, err: e instanceof Error ? e.message : String(e) });
    throw new AppError("ESCROW", "couldn't read the escrow, try again");
  }
  if (toStroops(balance) !== 0n) {
    throw AppError.conflict(`the escrow holds ${fromStroops(toStroops(balance))} USDC, so this campaign cannot be abandoned`);
  }
  // One statement decides: a fund sent or confirmed since the checks above leaves the row as it is.
  const sent = conn
    .select({ id: escrowOps.id })
    .from(escrowOps)
    .where(and(eq(escrowOps.campaignId, campaignId), eq(escrowOps.kind, "fund"), inArray(escrowOps.status, ["submitted", "failed", "confirmed"])));
  const [row] = await conn
    .update(campaigns)
    .set({ closedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), isNotNull(campaigns.escrowContractId), isNull(campaigns.fundedAt), isNull(campaigns.closedAt), notExists(sent)))
    .returning();
  if (!row) throw AppError.conflict("campaign changed; reload and try again");
  return row;
}
