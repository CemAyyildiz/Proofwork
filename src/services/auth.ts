import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { authNonces, roleGrants } from "@/db/schema";
import { challengeMessage, pubkeySchema, verifySignedMessage } from "@/domain/wallet-auth";
import { AppError } from "@/lib/errors";

/** Wallet authentication (AD-7): single-use nonce challenge, see domain/wallet-auth.ts. */
const NONCE_TTL_MS = 5 * 60 * 1000;

export async function issueChallenge(pubkey: string, conn: Db = db): Promise<{ nonce: string; message: string }> {
  const pk = pubkeySchema.parse(pubkey);
  const nonce = randomBytes(24).toString("base64url");
  await conn.insert(authNonces).values({ nonce, pubkey: pk, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return { nonce, message: challengeMessage(nonce) };
}

export async function consumeChallenge(
  input: { pubkey: string; nonce: string; signature: string },
  conn: Db = db,
): Promise<{ pubkey: string }> {
  const pk = pubkeySchema.parse(input.pubkey);
  const rows = await conn
    .select()
    .from(authNonces)
    .where(and(eq(authNonces.nonce, input.nonce), eq(authNonces.pubkey, pk), isNull(authNonces.usedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw AppError.unauthenticated("unknown or used challenge");
  if (row.expiresAt.getTime() < Date.now()) throw AppError.unauthenticated("challenge expired");
  if (!verifySignedMessage(pk, challengeMessage(input.nonce), input.signature)) {
    throw AppError.unauthenticated("signature does not verify");
  }
  const updated = await conn
    .update(authNonces)
    .set({ usedAt: new Date() })
    .where(and(eq(authNonces.nonce, input.nonce), isNull(authNonces.usedAt)))
    .returning({ nonce: authNonces.nonce });
  if (updated.length !== 1) throw AppError.unauthenticated("challenge already used");
  return { pubkey: pk };
}

export type Role = "funder" | "reviewer" | "ops";

export async function rolesFor(pubkey: string, campaignId: string | null, conn: Db = db): Promise<Set<Role>> {
  const rows = await conn.select().from(roleGrants).where(eq(roleGrants.pubkey, pubkey));
  const out = new Set<Role>();
  for (const r of rows) {
    if (r.campaignId === null || r.campaignId === campaignId) out.add(r.role);
  }
  return out;
}

export async function requireRole(pubkey: string, role: Role, campaignId: string | null, conn: Db = db): Promise<void> {
  const roles = await rolesFor(pubkey, campaignId, conn);
  if (!roles.has(role)) throw AppError.forbidden(`requires ${role} role`);
}
