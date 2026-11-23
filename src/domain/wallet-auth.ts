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

/**
 * What a login signature covers, SIWE / SEP-10 style: the site that asked,
 * the account, the network, the nonce and its validity window. A signature
 * collected by another site, for another network or after expiry never
 * verifies here. The server builds this text from its own records and the
 * request it is answering; the wallet signs it exactly as received.
 */
export interface ChallengeFields {
  /** Host of the site the request reached (`proofwork.app`, `localhost:3000`), never caller input. */
  host: string;
  pubkey: string;
  /** "Stellar testnet" / "Stellar mainnet". */
  network: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export function challengeMessage(f: ChallengeFields): string {
  return [
    `${f.host} asks you to sign in to Proofwork`,
    `account: ${f.pubkey}`,
    `network: ${f.network}`,
    `nonce: ${f.nonce}`,
    `issued at: ${f.issuedAt.toISOString()}`,
    `expires at: ${f.expiresAt.toISOString()}`,
  ].join("\n");
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
