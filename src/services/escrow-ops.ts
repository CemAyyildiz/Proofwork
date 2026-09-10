import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, escrowOps, type EscrowOp } from "@/db/schema";
import type { EscrowPort, Submitted } from "@/escrow/port";
import { AppError } from "@/lib/errors";
import { idempotencyKey, newId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { txHashOf } from "@/lib/tx";

/**
 * Wallet-signed escrow operations follow one protocol (AD-9):
 *
 *   prepare  → escrow_op(intent) + unsigned XDR, hash recorded
 *   sign     → in the user's wallet, client side
 *   submit   → hash of signed XDR must equal the prepared hash,
 *              escrow_op(submitted → confirmed | failed) with tx hash
 *
 * The idempotency key makes a retried prepare reuse the same row, and a
 * confirmed row can never be submitted twice.
 */
export type OpKind = EscrowOp["kind"];

export interface PreparedOp {
  opId: string;
  kind: OpKind;
  unsignedXdr: string;
  milestoneIndex: number | null;
}

interface PrepareArgs {
  campaignId: string;
  kind: OpKind;
  /** parts that make this op unique, e.g. ["release", campaignId, milestoneIndex] */
  keyParts: Array<string | number>;
  build: () => Promise<{ unsignedXdr: string; milestoneIndex?: number }>;
}

export async function prepareOp(args: PrepareArgs, conn: Db = db): Promise<PreparedOp> {
  const key = idempotencyKey(args.keyParts);
  const existing = (await conn.select().from(escrowOps).where(eq(escrowOps.idempotencyKey, key)).limit(1))[0];
  if (existing?.status === "confirmed") {
    throw AppError.conflict(`${args.kind} already confirmed (tx ${existing.txHash ?? "?"})`);
  }
  if (existing?.status === "submitted") {
    throw AppError.conflict(`${args.kind} is being submitted; wait for confirmation`);
  }

  const built = await args.build();
  const unsignedHash = txHashOf(built.unsignedXdr);
  const payload = { unsignedHash, milestoneIndex: built.milestoneIndex ?? null };

  if (existing) {
    await conn.update(escrowOps).set({ status: "intent", payload, error: null }).where(eq(escrowOps.id, existing.id));
    return { opId: existing.id, kind: args.kind, unsignedXdr: built.unsignedXdr, milestoneIndex: payload.milestoneIndex };
  }
  const id = newId("op");
  await conn.insert(escrowOps).values({ id, campaignId: args.campaignId, kind: args.kind, idempotencyKey: key, payload, status: "intent" });
  return { opId: id, kind: args.kind, unsignedXdr: built.unsignedXdr, milestoneIndex: payload.milestoneIndex };
}

export interface SubmitResult extends Submitted {
  op: EscrowOp;
}

export async function submitOp(
  input: { opId: string; campaignId: string; signedXdr: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<SubmitResult> {
  const op = (
    await conn
      .select()
      .from(escrowOps)
      .where(and(eq(escrowOps.id, input.opId), eq(escrowOps.campaignId, input.campaignId)))
      .limit(1)
  )[0];
  if (!op) throw AppError.notFound("escrow operation");
  if (op.status === "confirmed") throw AppError.conflict("operation already confirmed");
  if (op.status === "submitted") throw AppError.conflict("operation already submitted");

  const expected = (op.payload as { unsignedHash?: string }).unsignedHash;
  const actual = txHashOf(input.signedXdr);
  if (!expected || expected !== actual) {
    throw AppError.validation("signed transaction does not match the prepared operation");
  }

  // Claim the row first so two concurrent submits cannot both reach the network.
  const claimed = await conn
    .update(escrowOps)
    .set({ status: "submitted" })
    .where(and(eq(escrowOps.id, op.id), eq(escrowOps.status, "intent")))
    .returning({ id: escrowOps.id });
  if (claimed.length !== 1) throw AppError.conflict("operation already in progress");

  try {
    const res = await escrow.submit(input.signedXdr);
    const [updated] = await conn
      .update(escrowOps)
      .set({ status: "confirmed", txHash: res.txHash, error: null })
      .where(eq(escrowOps.id, op.id))
      .returning();
    log.info("escrow op confirmed", { opId: op.id, kind: op.kind, txHash: res.txHash });
    return { ...res, op: updated as EscrowOp };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await conn.update(escrowOps).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(escrowOps.id, op.id));
    log.error("escrow op failed", { opId: op.id, kind: op.kind, err: message });
    throw e;
  }
}

export async function recordServerOp(
  input: { campaignId: string; kind: OpKind; keyParts: Array<string | number>; run: () => Promise<Submitted> },
  conn: Db = db,
): Promise<Submitted> {
  const key = idempotencyKey(input.keyParts);
  const existing = (await conn.select().from(escrowOps).where(eq(escrowOps.idempotencyKey, key)).limit(1))[0];
  if (existing?.status === "confirmed" && existing.txHash) return { txHash: existing.txHash };
  const id = existing?.id ?? newId("op");
  if (!existing) {
    await conn.insert(escrowOps).values({ id, campaignId: input.campaignId, kind: input.kind, idempotencyKey: key, payload: {}, status: "submitted" });
  } else {
    await conn.update(escrowOps).set({ status: "submitted", error: null }).where(eq(escrowOps.id, id));
  }
  try {
    const res = await input.run();
    await conn.update(escrowOps).set({ status: "confirmed", txHash: res.txHash }).where(eq(escrowOps.id, id));
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await conn.update(escrowOps).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(escrowOps.id, id));
    throw e;
  }
}

export async function listOps(campaignId: string, conn: Db = db): Promise<EscrowOp[]> {
  return conn.select().from(escrowOps).where(eq(escrowOps.campaignId, campaignId)).orderBy(escrowOps.at);
}

export async function campaignOwnedBy(campaignId: string, funderPubkey: string, conn: Db = db) {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  if (!c) throw AppError.notFound("campaign");
  if (c.funderPubkey !== funderPubkey) throw AppError.forbidden("not the funder of this campaign");
  return c;
}
