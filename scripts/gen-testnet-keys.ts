import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Generates signing keys and prints .env lines. Secrets are printed once, to
 * stdout, and nowhere else.
 *
 *   pnpm keys:gen            testnet: the server keys plus a funder and a resolver
 *                            key for the scripts. Fund each with Friendbot
 *                            (pnpm accounts:prepare does this for you).
 *   pnpm keys:gen --mainnet  the three server keys and the session secret only.
 *                            The dispute resolver key is not made here: it is
 *                            created in a wallet and never reaches a server or
 *                            an env file. Send a few XLM to each public key so
 *                            the accounts exist; none of them ever holds USDC.
 */
const server = ["PLATFORM_ADMIN_SECRET", "PLATFORM_OPS_SECRET", "DECISION_LEDGER_SECRET"];
const mainnet = process.argv.slice(2).includes("--mainnet");
const names = mainnet ? server : [...server, "FUNDER_SECRET", "DISPUTE_RESOLVER_SECRET"];

for (const name of names) {
  const kp = Keypair.random();
  process.stdout.write(`${name}=${kp.secret()}   # public: ${kp.publicKey()}\n`);
}
process.stdout.write(`SESSION_SECRET=${randomBytes(48).toString("base64")}\n`);
