import "server-only";
import { eq } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, type Campaign } from "@/db/schema";
import type { EscrowPort } from "@/escrow/port";
import { AppError } from "@/lib/errors";
import { findOp, prepareOp, submitOp, type OnConfirmed, type Verify } from "./escrow-ops";
import { recordRemainder } from "./payout";
import { checkRemainder, isEmptyBalance, RemainderError, type RemainderCheck } from "./remainder";

/**
 * The remainder return started in the app (CAP-18, AD-4): the wallet that is
 * a closed campaign's dispute resolver signs `withdraw-remaining-funds` in
 * its own wallet and the server submits it. No server key signs.
 *
 *   prepare → the session wallet must be the campaign's resolver; the same
 *             checks as `pnpm escrow:close` (`checkRemainder`); one
 *             distribution, the whole on-chain balance to the escrow's
 *             on-chain funder
 *   submit  → the signed hash must equal the prepared one; the checks run
 *             again; `remainder_tx_hash` is written once the escrow reads empty
 *
 * The contract lets the resolver name any receiver, so the app builds the one
 * distribution itself and never takes one from the caller.
 */
export interface PreparedRemainder {
  opId: string;
  unsignedXdr: string;
  /** The escrow's balance read from chain at prepare: what the transaction returns. */
  amount: string;
  /** The escrow's funder read from chain: the only receiver. */
  funder: string;
}

const KIND = "withdraw_remaining" as const;

/** The campaign, for its dispute resolver only. Nothing is read from chain or built for anyone else. */
async function campaignForResolver(campaignId: string, actor: { pubkey: string }, conn: Db): Promise<Campaign & { escrowContractId: string }> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  if (!c) throw AppError.notFound("campaign");
  if (c.disputeResolverPubkey !== actor.pubkey) throw AppError.forbidden("not the dispute resolver of this campaign");
  if (!c.escrowContractId) throw AppError.conflict("campaign has no escrow");
  return { ...c, escrowContractId: c.escrowContractId };
}

/** `returnRemainder`'s refusals as the route answers them; nothing was built when they are thrown. */
function asConflict(e: unknown, contractId: string): unknown {
  if (!(e instanceof RemainderError)) return e;
  if (e.kind === "empty_unrecorded") {
    return AppError.conflict(
      `the escrow is empty and no remainder is recorded on this campaign; the operator records the return with: pnpm escrow:close ${contractId} --record <tx hash>`,
    );
  }
  return AppError.conflict(e.message);
}

/** The checks of `pnpm escrow:close`, with the session wallet as the resolver. Returns what to send and to whom. */
async function sweepTarget(c: Campaign & { escrowContractId: string }, actor: { pubkey: string }, escrow: EscrowPort, conn: Db) {
  let check: RemainderCheck;
  try {
    check = await checkRemainder({ contractId: c.escrowContractId, resolver: actor.pubkey, resolverName: "this wallet" }, escrow, conn);
  } catch (e) {
    throw asConflict(e, c.escrowContractId);
  }
  if (check.outcome === "nothing") {
    throw AppError.conflict(check.recordedTxHash ? `the remainder was already returned (tx ${check.recordedTxHash})` : "the escrow is empty: there is nothing to return");
  }
  // The escrow column is unique, so the campaign found by escrow is this one; checked rather than assumed.
  if (check.campaign?.id !== c.id) throw AppError.conflict("this escrow belongs to another campaign");
  return { funder: check.funder, amount: check.state.balance };
}

/** The return is visible once the escrow reads empty. */
function emptied(escrow: EscrowPort, contractId: string): Verify {
  return async () => isEmptyBalance((await escrow.getEscrow(contractId)).balance);
}

/** Record the confirmed return on the campaign; the same hash again changes nothing. */
function returned(campaignId: string, conn: Db): OnConfirmed {
  return async (op) => {
    if (!op.txHash) throw new AppError("INTERNAL", "confirmed return has no transaction hash");
    await recordRemainder(campaignId, op.txHash, conn);
  };
}

export async function prepareRemainderReturn(campaignId: string, actor: { pubkey: string }, escrow: EscrowPort, conn: Db = db): Promise<PreparedRemainder> {
  const c = await campaignForResolver(campaignId, actor, conn);
  const contractId = c.escrowContractId;
  // Filled by `build`; read only after prepareOp returns, which it does only after a build.
  const plan: { target?: { funder: string; amount: string } } = {};
  const op = await prepareOp(
    {
      campaignId,
      kind: KIND,
      keyParts: ["withdraw-remaining", campaignId],
      build: async () => {
        const target = await sweepTarget(c, actor, escrow, conn);
        plan.target = target;
        const u = await escrow.buildWithdrawRemaining(contractId, actor.pubkey, [{ address: target.funder, amount: target.amount }]);
        return { unsignedXdr: u.unsignedXdr };
      },
      verify: emptied(escrow, contractId),
      onConfirmed: returned(campaignId, conn),
    },
    conn,
  );
  if (!plan.target) throw new AppError("INTERNAL", "remainder return prepared without a target");
  return { opId: op.opId, unsignedXdr: op.unsignedXdr, amount: plan.target.amount, funder: plan.target.funder };
}

export async function confirmRemainderReturn(
  input: { campaignId: string; opId: string; signedXdr: string },
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<{ txHash: string }> {
  const c = await campaignForResolver(input.campaignId, actor, conn);
  const op = await findOp(input.opId, input.campaignId, conn);
  if (op.kind !== KIND) throw AppError.validation(`operation is a ${op.kind}, not a remainder return`);
  // Again right before sending: a return recorded or a milestone opened since prepare stops it here.
  await sweepTarget(c, actor, escrow, conn);
  const res = await submitOp({ ...input, expectedKind: KIND, verify: emptied(escrow, c.escrowContractId) }, escrow, conn);
  await returned(input.campaignId, conn)(res.op);
  return { txHash: res.txHash };
}
