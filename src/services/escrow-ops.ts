import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, escrowOps, type EscrowOp } from "@/db/schema";
import type { EscrowPort, Submitted } from "@/escrow/port";
import { AppError, isUniqueViolation } from "@/lib/errors";
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
 * Chain state, not the send-transaction response, decides the outcome: each
 * op carries a `verify` closure that reads the escrow and reports whether the
 * op's effect is visible. It runs after submit, after a submit error, and
 * when a stale `submitted` or a `failed` row is prepared again. The
 * idempotency key makes a retried prepare reuse the same row, and a
 * confirmed row can never be submitted twice.
 */
export type OpKind = EscrowOp["kind"];

/** Reads chain state; true when the op's effect is visible on the escrow. */
export type Verify = (res: Submitted) => Promise<boolean>;

/** A `submitted` row older than this is treated as abandoned and reconciled from chain state. */
export const STALE_SUBMITTED_MS = 120_000;

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
  verify: Verify;
}

/** A verifier error never confirms an op: a flaky read counts as "not visible". */
async function safeVerify(verify: Verify, res: Submitted, ctx: { opId: string; kind: OpKind }): Promise<boolean> {
  try {
    return await verify(res);
  } catch (e) {
    log.warn("escrow op verify failed", { ...ctx, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

function preparedHash(op: EscrowOp): string | undefined {
  return (op.payload as { unsignedHash?: string }).unsignedHash;
}

async function markConfirmed(conn: Db, id: string, txHash: string): Promise<EscrowOp> {
  const [row] = await conn.update(escrowOps).set({ status: "confirmed", txHash, error: null }).where(eq(escrowOps.id, id)).returning();
  if (!row) throw AppError.notFound("escrow operation");
  return row;
}

async function markFailed(conn: Db, id: string, message: string): Promise<void> {
  await conn.update(escrowOps).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(escrowOps.id, id));
}

/**
 * A stale `submitted` or a `failed` row may still have landed on chain. Ask
 * the chain first: if the effect is there the op is confirmed with the hash
 * we prepared, and the caller gets a conflict instead of a second tx.
 * Otherwise the row is left `failed` for a fresh prepare.
 */
async function reconcile(conn: Db, op: EscrowOp, verify: Verify): Promise<void> {
  const hash = preparedHash(op);
  if (hash && (await safeVerify(verify, { txHash: hash }, { opId: op.id, kind: op.kind }))) {
    await markConfirmed(conn, op.id, hash);
    log.info("escrow op reconciled from chain", { opId: op.id, kind: op.kind, txHash: hash });
    throw AppError.conflict(`${op.kind} already confirmed (tx ${hash})`);
  }
  if (op.status === "submitted") {
    const moved = await conn
      .update(escrowOps)
      .set({ status: "failed", error: "abandoned in submitted; effect not visible on chain" })
      .where(and(eq(escrowOps.id, op.id), eq(escrowOps.status, "submitted")))
      .returning({ id: escrowOps.id });
    if (moved.length !== 1) throw AppError.conflict(`${op.kind} changed concurrently; retry`);
    log.warn("stale escrow op marked failed", { opId: op.id, kind: op.kind });
  }
}

export async function prepareOp(args: PrepareArgs, conn: Db = db): Promise<PreparedOp> {
  const key = idempotencyKey(args.keyParts);
  const existing = (await conn.select().from(escrowOps).where(eq(escrowOps.idempotencyKey, key)).limit(1))[0];
  if (existing?.status === "confirmed") {
    throw AppError.conflict(`${args.kind} already confirmed (tx ${existing.txHash ?? "?"})`);
  }
  if (existing?.status === "submitted" && Date.now() - existing.updatedAt.getTime() < STALE_SUBMITTED_MS) {
    throw AppError.conflict(`${args.kind} is being submitted; wait for confirmation`);
  }
  if (existing?.status === "submitted" || existing?.status === "failed") {
    await reconcile(conn, existing, args.verify);
  }

  const built = await args.build();
  const unsignedHash = txHashOf(built.unsignedXdr);
  const payload = { unsignedHash, milestoneIndex: built.milestoneIndex ?? null };

  if (existing) {
    const reused = await conn
      .update(escrowOps)
      .set({ status: "intent", payload, error: null })
      .where(and(eq(escrowOps.id, existing.id), inArray(escrowOps.status, ["intent", "failed"])))
      .returning({ id: escrowOps.id });
    if (reused.length !== 1) throw AppError.conflict(`${args.kind} changed concurrently; retry`);
    return { opId: existing.id, kind: args.kind, unsignedXdr: built.unsignedXdr, milestoneIndex: payload.milestoneIndex };
  }
  const id = newId("op");
  try {
    await conn.insert(escrowOps).values({ id, campaignId: args.campaignId, kind: args.kind, idempotencyKey: key, payload, status: "intent" });
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict(`${args.kind} is already being prepared; retry`);
    throw e;
  }
  return { opId: id, kind: args.kind, unsignedXdr: built.unsignedXdr, milestoneIndex: payload.milestoneIndex };
}

export interface SubmitResult extends Submitted {
  op: EscrowOp;
}

/** The op row for this campaign, or NOT_FOUND. */
export async function findOp(opId: string, campaignId: string, conn: Db = db): Promise<EscrowOp> {
  const op = (
    await conn
      .select()
      .from(escrowOps)
      .where(and(eq(escrowOps.id, opId), eq(escrowOps.campaignId, campaignId)))
      .limit(1)
  )[0];
  if (!op) throw AppError.notFound("escrow operation");
  return op;
}

export async function submitOp(
  input: { opId: string; campaignId: string; signedXdr: string; expectedKind: OpKind; verify: Verify },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<SubmitResult> {
  const op = await findOp(input.opId, input.campaignId, conn);
  if (op.kind !== input.expectedKind) {
    throw AppError.validation(`operation is a ${op.kind}, not a ${input.expectedKind}`);
  }
  if (op.status === "confirmed") throw AppError.conflict("operation already confirmed");
  if (op.status === "submitted") throw AppError.conflict("operation already submitted");

  const expected = preparedHash(op);
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

  const ctx = { opId: op.id, kind: op.kind };
  let res: Submitted;
  try {
    res = await escrow.submit(input.signedXdr);
  } catch (e) {
    // A timeout can hide a tx that landed; only the chain can tell.
    if (!(await safeVerify(input.verify, { txHash: actual }, ctx))) {
      const message = e instanceof Error ? e.message : String(e);
      await markFailed(conn, op.id, message);
      log.error("escrow op failed", { ...ctx, err: message });
      throw e;
    }
    log.warn("escrow submit errored but effect is on chain", { ...ctx, txHash: actual });
    res = { txHash: actual };
  }

  if (!(await safeVerify(input.verify, res, ctx))) {
    await markFailed(conn, op.id, "effect not visible on chain");
    log.error("escrow op not visible on chain", { ...ctx, txHash: actual });
    throw new AppError("ESCROW", "effect not visible on chain", { txHash: actual });
  }
  const updated = await markConfirmed(conn, op.id, actual);
  log.info("escrow op confirmed", { ...ctx, txHash: actual });
  return { ...res, txHash: actual, op: updated };
}

/**
 * Server-signed ops run at most once per idempotency key: the row is claimed
 * (inserted, or moved from intent/failed) as `submitted` before `run`, so a
 * concurrent or repeated call gets a conflict instead of a second tx.
 */
export async function recordServerOp(
  input: { campaignId: string; kind: OpKind; keyParts: Array<string | number>; run: () => Promise<Submitted> },
  conn: Db = db,
): Promise<Submitted> {
  const key = idempotencyKey(input.keyParts);
  const existing = (await conn.select().from(escrowOps).where(eq(escrowOps.idempotencyKey, key)).limit(1))[0];
  if (existing?.status === "confirmed" && existing.txHash) return { txHash: existing.txHash };
  if (existing?.status === "submitted") throw AppError.conflict(`${input.kind} in progress`);

  let id: string;
  if (!existing) {
    id = newId("op");
    try {
      await conn.insert(escrowOps).values({ id, campaignId: input.campaignId, kind: input.kind, idempotencyKey: key, payload: {}, status: "submitted" });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict(`${input.kind} in progress`);
      throw e;
    }
  } else {
    id = existing.id;
    const claimed = await conn
      .update(escrowOps)
      .set({ status: "submitted", error: null })
      .where(and(eq(escrowOps.id, id), inArray(escrowOps.status, ["intent", "failed"])))
      .returning({ id: escrowOps.id });
    if (claimed.length !== 1) throw AppError.conflict(`${input.kind} in progress`);
  }

  try {
    const res = await input.run();
    await conn.update(escrowOps).set({ status: "confirmed", txHash: res.txHash, error: null }).where(eq(escrowOps.id, id));
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(conn, id, message);
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
