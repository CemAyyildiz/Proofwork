import { createHash } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

/**
 * Pure wallet-signature verification, no I/O. Verified against SEP-53
 * ("Stellar Signed Message") first, then raw bytes, because wallets differ
 * in which convention they implement.
 */
const SEP53_PREFIX = "Stellar Signed Message:\n";

export const pubkeySchema = z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "invalid public key");

export function challengeMessage(nonce: string): string {
  return `Proofwork login\nnonce: ${nonce}`;
}

export function verifySignedMessage(pubkey: string, message: string, signatureBase64: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(pubkey)) return false;
  const kp = Keypair.fromPublicKey(pubkey);
  const sig = Buffer.from(signatureBase64, "base64");
  if (sig.length !== 64) return false;
  const sep53 = createHash("sha256").update(SEP53_PREFIX + message, "utf8").digest();
  if (kp.verify(sep53, sig)) return true;
  return kp.verify(Buffer.from(message, "utf8"), sig);
}
