import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";

/**
 * Creates every server/spike account on testnet via Friendbot and opens the
 * USDC trustline on the accounts that receive USDC. Idempotent.
 *   pnpm accounts:prepare
 */
const seed = z.string().refine((v) => StrKey.isValidEd25519SecretSeed(v));
const env = z
  .object({
    HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
    USDC_ISSUER: z.string().default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    PLATFORM_ADMIN_SECRET: seed,
    PLATFORM_OPS_SECRET: seed,
    DECISION_LEDGER_SECRET: seed,
    FUNDER_SECRET: seed,
    DISPUTE_RESOLVER_SECRET: seed,
  })
  .parse(process.env);

const horizon = new Horizon.Server(env.HORIZON_URL);
const USDC = new Asset("USDC", env.USDC_ISSUER);

async function ensureFunded(name: string, kp: Keypair): Promise<void> {
  try {
    await horizon.loadAccount(kp.publicKey());
    process.stdout.write(`${name}: exists ${kp.publicKey()}\n`);
  } catch {
    const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    if (!r.ok) throw new Error(`friendbot failed for ${name}: ${r.status}`);
    process.stdout.write(`${name}: created via friendbot ${kp.publicKey()}\n`);
  }
}

async function ensureTrustline(name: string, kp: Keypair): Promise<void> {
  const acct = await horizon.loadAccount(kp.publicKey());
  const has = acct.balances.some((b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === env.USDC_ISSUER);
  if (has) {
    process.stdout.write(`${name}: USDC trustline present\n`);
    return;
  }
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  process.stdout.write(`${name}: USDC trustline opened tx=${res.hash}\n`);
}

async function main(): Promise<void> {
  const accounts: Array<[string, Keypair, boolean]> = [
    ["platform-admin", Keypair.fromSecret(env.PLATFORM_ADMIN_SECRET), true],
    ["platform-ops", Keypair.fromSecret(env.PLATFORM_OPS_SECRET), false],
    ["decision-ledger", Keypair.fromSecret(env.DECISION_LEDGER_SECRET), false],
    ["funder", Keypair.fromSecret(env.FUNDER_SECRET), true],
    ["dispute-resolver", Keypair.fromSecret(env.DISPUTE_RESOLVER_SECRET), false],
  ];
  for (const [name, kp] of accounts) await ensureFunded(name, kp);
  for (const [name, kp, usdc] of accounts) if (usdc) await ensureTrustline(name, kp);
}

main().catch((e) => {
  process.stderr.write(`prepare failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
