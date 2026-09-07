import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Generates the server-side testnet keys and prints .env lines. Fund each
 * public key with Friendbot afterwards (the spike script does this for you).
 * Secrets are printed once, to stdout, and nowhere else.
 */
const names = ["PLATFORM_ADMIN_SECRET", "PLATFORM_OPS_SECRET", "DECISION_LEDGER_SECRET", "FUNDER_SECRET", "DISPUTE_RESOLVER_SECRET"];

for (const name of names) {
  const kp = Keypair.random();
  process.stdout.write(`${name}=${kp.secret()}   # public: ${kp.publicKey()}\n`);
}
process.stdout.write(`SESSION_SECRET=${randomBytes(48).toString("base64")}\n`);
