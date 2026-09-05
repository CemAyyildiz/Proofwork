import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l ambiguity

/** URL-safe, unguessable identifier. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

/** Short, human-readable id used as the on-chain ledger key suffix (8 chars). */
export function newShortId(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic key so a retried escrow write never submits twice. */
export function idempotencyKey(parts: Array<string | number>): string {
  return sha256Hex(parts.join("|"));
}
