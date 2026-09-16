import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db/client";
import { campaigns, type Campaign, type EscrowOp } from "@/db/schema";
import { assertPositiveAmount, toStroops } from "@/escrow/amount";
import type { EscrowPort, Submitted } from "@/escrow/port";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { campaignOwnedBy, prepareOp, submitOp, type OnConfirmed, type PreparedOp, type Verify } from "./escrow-ops";

const CLOSE_MILESTONE_AMOUNT = "0.0000001";

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
  .refine((c) => toStroops(c.budget) >= toStroops(c.rewardAmount), { message: "budget must cover at least one reward", path: ["budget"] });

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

export async function createCampaign(
  input: CreateCampaignInput,
  actor: { pubkey: string; platformAdmin: string; platformOps: string },
  conn: Db = db,
): Promise<Campaign> {
  const taken = new Set([actor.platformAdmin, actor.platformOps, actor.pubkey]);
  if (taken.has(input.disputeResolverPubkey)) {
    throw AppError.validation("dispute resolver must be a neutral key, not the funder or a platform key");
  }
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

/** Step 1 of funding: build the deploy transaction for the funder's wallet. */
export async function prepareDeploy(
  campaignId: string,
  actor: { pubkey: string; platformAdmin: string; platformOps: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<PreparedOp> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (c.escrowContractId) throw AppError.conflict("escrow already deployed");
  return prepareOp(
    {
      campaignId,
      kind: "deploy",
      keyParts: ["deploy", campaignId],
      build: () =>
        escrow.buildDeploy({
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
        }),
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
  conn: Db = db,
): Promise<{ txHash: string; contractId: string }> {
  const c = await campaignOwnedBy(input.campaignId, actor.pubkey, conn);
  const res = await submitOp({ ...input, expectedKind: "deploy", verify: deployVisible(escrow, c.slug) }, escrow, conn);
  if (!res.contractId) throw new AppError("ESCROW", "deploy confirmed but provider returned no contract id", { txHash: res.txHash });
  await deployConfirmed(input.campaignId, conn)(res.op);
  return { txHash: res.txHash, contractId: res.contractId };
}

/** Step 2 of funding: move the budget into escrow. */
export async function prepareFund(campaignId: string, actor: { pubkey: string }, escrow: EscrowPort, conn: Db = db): Promise<PreparedOp> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("deploy the escrow first");
  if (c.fundedAt) throw AppError.conflict("campaign already funded");
  const contractId = c.escrowContractId;
  return prepareOp(
    {
      campaignId,
      kind: "fund",
      keyParts: ["fund", campaignId],
      build: () => escrow.buildFund(contractId, c.funderPubkey, c.budget),
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
  const res = await submitOp({ ...input, expectedKind: "fund", verify: fundVisible(escrow, c.escrowContractId, c.budget) }, escrow, conn);
  await fundConfirmed(input.campaignId, conn)(res.op);
  return { txHash: res.txHash };
}
