import "server-only";
import { Networks, TransactionBuilder, type Keypair } from "@stellar/stellar-sdk";
import type { Db } from "@/db/client";
import type { Campaign } from "@/db/schema";
import { toStroops } from "@/escrow/amount";
import type { EscrowPort } from "@/escrow/port";
import { isAppError } from "@/lib/errors";
import { txHashOf } from "@/lib/tx";
import { campaignForEscrow, recordRemainder } from "./payout";

/**
 * Returning a campaign escrow's remainder to its funder (AD-4), as
 * `pnpm escrow:close` runs it. The sweep is signed outside the app with the
 * dispute resolver key and cannot be repeated, so everything that can refuse
 * does so before a signature, and the chain decides what is recorded.
 *
 * `conn` is the app's database, or null to sweep without recording.
 */

/**
 * `refused`: nothing was signed, or what was sent had no effect.
 * `empty_unrecorded`: the escrow holds nothing and the campaign has no remainder hash.
 * `swept_unrecorded`: the sweep `txHash` went out and is not on the campaign row.
 */
export type RemainderFailure = "refused" | "empty_unrecorded" | "swept_unrecorded";

export class RemainderError extends Error {
  constructor(
    readonly kind: RemainderFailure,
    message: string,
    readonly txHash?: string,
  ) {
    super(message);
    this.name = "RemainderError";
  }
}

const refuse = (message: string) => new RemainderError("refused", message);

export interface RemainderSigners {
  /** Signs the sweep; must be the escrow's dispute resolver. */
  resolver: Keypair;
  /** Only for an escrow this same key funded, outside the app: disputes the close milestone first. */
  ownFunder?: Keypair | null;
}

export type RemainderResult =
  /** `recorded` is false only when there is no database to record in. */
  | { outcome: "swept"; txHash: string; recorded: boolean }
  /** The escrow was already empty. `recordedTxHash` is the hash on the campaign, null without a database. */
  | { outcome: "nothing"; recordedTxHash: string | null };

type Say = (line: string) => void;

function sign(kp: Keypair, unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(kp);
  return tx.toXDR();
}

const empty = (balance: string) => toStroops(balance) === 0n;
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The campaign a sweep belongs to: known to this database, funded by the escrow's funder, closed in the app. */
async function campaignOfSweep(contractId: string, funder: string, conn: Db): Promise<Campaign> {
  let c: Campaign;
  try {
    c = await campaignForEscrow(contractId, conn);
  } catch (e) {
    if (!isAppError(e) || e.code !== "NOT_FOUND") throw e;
    throw refuse("no campaign with this escrow in the database; nothing was signed");
  }
  if (c.funderPubkey !== funder) throw refuse(`campaign ${c.slug} has another funder in the database than the escrow has on chain; nothing was signed`);
  if (!c.closedAt) throw refuse(`campaign ${c.slug} is not closed in the app: its funder closes it there first; nothing was signed`);
  return c;
}

/**
 * Sweep the escrow's whole balance to its own funder and record the
 * transaction on the campaign. The sweep's hash is taken from the signed
 * transaction and said before it is sent, so it is known whatever happens to
 * the reply.
 */
export async function returnRemainder(
  input: { contractId: string; signers: RemainderSigners; say: Say },
  escrow: EscrowPort,
  conn: Db | null,
): Promise<RemainderResult> {
  const { contractId, say } = input;
  const { resolver, ownFunder } = input.signers;

  const before = await escrow.getEscrow(contractId);
  if (before.roles.disputeResolver !== resolver.publicKey()) throw refuse("the configured resolver key is not this escrow's dispute resolver");
  const funder = before.roles.funder;
  const open = before.milestones.filter((m, i) => i !== 0 && !(m.released || m.resolved || m.disputed));
  if (open.length > 0) throw refuse(`milestones still open: ${open.map((m) => m.index).join(", ")} — release or dispute them first`);
  say(`balance: ${before.balance} USDC, milestones: ${before.milestones.length}`);
  say(`escrow funder: ${funder} (the remainder goes to this address)`);

  const campaign = conn ? await campaignOfSweep(contractId, funder, conn) : null;
  if (campaign) say(`campaign: ${campaign.slug}`);

  if (empty(before.balance)) {
    // A campaign that was never funded (abandoned) has an empty escrow and no remainder to miss.
    if (campaign?.fundedAt && !campaign.remainderTxHash) {
      throw new RemainderError("empty_unrecorded", `the escrow is empty and campaign ${campaign.slug} has no remainder recorded`);
    }
    return { outcome: "nothing", recordedTxHash: campaign?.remainderTxHash ?? null };
  }
  if (campaign?.remainderTxHash) {
    throw refuse(`campaign ${campaign.slug} already has remainder ${campaign.remainderTxHash} recorded while the escrow holds ${before.balance} USDC; nothing was signed`);
  }

  const close = before.milestones[0];
  if (close && !close.disputed && !close.released && !close.resolved) {
    if (!ownFunder || ownFunder.publicKey() !== funder) {
      throw refuse("close milestone not disputed yet: the funder must close the campaign in the app first");
    }
    for (const u of await escrow.buildDispute(contractId, funder, [0])) {
      say(`dispute close milestone: ${(await escrow.submit(sign(ownFunder, u.unsignedXdr))).txHash}`);
    }
  }

  const sweep = await escrow.buildWithdrawRemaining(contractId, resolver.publicKey(), [{ address: funder, amount: before.balance }]);
  const signed = sign(resolver, sweep.unsignedXdr);
  const txHash = txHashOf(signed);
  say(`withdraw remaining → funder: ${txHash} (signed, sending)`);

  let submitError: unknown = null;
  try {
    await escrow.submit(signed);
  } catch (e) {
    submitError = e;
  }
  let after: string;
  try {
    after = (await escrow.getEscrow(contractId)).balance;
  } catch (e) {
    // The reply is all there was to go on: a failed submit stays a failed submit, an accepted one may have landed.
    if (submitError) throw submitError;
    throw new RemainderError("swept_unrecorded", `the sweep was sent but the escrow could not be read afterwards (${reason(e)}), so nothing was recorded`, txHash);
  }
  if (submitError) {
    // A lost reply can hide a sweep that landed; only the escrow can tell.
    if (!empty(after)) throw submitError;
    say("the submit failed but the escrow is empty: the sweep landed");
  }
  say(`balance after: ${after} USDC`);
  if (!empty(after)) throw refuse(`the escrow still holds ${after} USDC after ${txHash}; nothing was recorded`);

  if (!campaign || !conn) return { outcome: "swept", txHash, recorded: false };
  try {
    await recordRemainder(campaign.id, txHash, conn);
  } catch (e) {
    throw new RemainderError("swept_unrecorded", `the sweep landed but could not be recorded on campaign ${campaign.slug} (${reason(e)})`, txHash);
  }
  say(`recorded remainder on campaign ${campaign.slug}`);
  return { outcome: "swept", txHash, recorded: true };
}

/**
 * Record a sweep that already happened, for a resolver that swept without the
 * app's database or a run that could not write. Signs nothing. Only while the
 * escrow reads empty: a hash is not recorded for money that is still there.
 */
export async function recordSweep(input: { contractId: string; txHash: string; say: Say }, escrow: EscrowPort, conn: Db): Promise<Campaign> {
  const state = await escrow.getEscrow(input.contractId);
  if (!empty(state.balance)) throw refuse(`the escrow still holds ${state.balance} USDC: there is no sweep to record`);
  const campaign = await campaignOfSweep(input.contractId, state.roles.funder, conn);
  input.say(`campaign: ${campaign.slug}`);
  try {
    const row = await recordRemainder(campaign.id, input.txHash, conn);
    input.say(`recorded remainder ${input.txHash} on campaign ${campaign.slug}`);
    return row;
  } catch (e) {
    if (isAppError(e) && (e.code === "CONFLICT" || e.code === "VALIDATION")) throw refuse(e.message);
    throw e;
  }
}
