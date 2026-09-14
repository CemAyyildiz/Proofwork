import { Keypair, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";
import { TrustlessWorkAdapter } from "../src/escrow/trustless-work/adapter";
import { TrustlessWorkClient } from "../src/escrow/trustless-work/client";

/**
 * Operator tool: return a campaign escrow's remainder to its funder (AD-4).
 * If the configured FUNDER_SECRET is the escrow's funder, it disputes the
 * close milestone first; otherwise the funder must already have closed the
 * campaign in the app. Then sweeps the whole balance to the escrow's funder
 * with the dispute resolver key. Refuses if any other milestone is open.
 *
 *   pnpm escrow:close <contractId>
 */
const seed = z.string().refine((v) => StrKey.isValidEd25519SecretSeed(v), "invalid secret seed");
const env = z
  .object({
    TW_BASE_URL: z.string().url().default("https://dev.api.trustlesswork.com"),
    TW_API_KEY: z.string().min(16),
    USDC_ISSUER: z.string().default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    PLATFORM_ADMIN_SECRET: seed,
    PLATFORM_OPS_SECRET: seed,
    FUNDER_SECRET: seed,
    DISPUTE_RESOLVER_SECRET: seed,
  })
  .parse(process.env);

function contractArg(): string {
  const arg = process.argv[2];
  if (!arg || !StrKey.isValidContract(arg)) {
    process.stderr.write("usage: pnpm escrow:close <contractId>\n");
    process.exit(2);
  }
  return arg;
}
const contractId = contractArg();

const funder = Keypair.fromSecret(env.FUNDER_SECRET);
const resolver = Keypair.fromSecret(env.DISPUTE_RESOLVER_SECRET);
const escrow = new TrustlessWorkAdapter({
  client: new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY),
  usdcIssuer: env.USDC_ISSUER,
  platformAdmin: Keypair.fromSecret(env.PLATFORM_ADMIN_SECRET),
  platformOps: Keypair.fromSecret(env.PLATFORM_OPS_SECRET),
});

/** If the app database is reachable, store the remainder tx on the campaign row. */
async function recordInDb(contract: string, txHash: string): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) return;
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`update campaign set remainder_tx_hash = ${txHash} where escrow_contract_id = ${contract} returning slug`;
    if (rows.length > 0) process.stdout.write(`recorded remainder on campaign ${rows[0]?.["slug"]}\n`);
  } finally {
    await sql.end();
  }
}

function signWith(kp: Keypair, unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(kp);
  return tx.toXDR();
}

async function main(): Promise<void> {
  const before = await escrow.getEscrow(contractId);
  if (before.roles.disputeResolver !== resolver.publicKey()) {
    throw new Error("escrow disputeResolver is not the configured DISPUTE_RESOLVER_SECRET key");
  }
  const weAreFunder = before.roles.funder === funder.publicKey();
  const open = before.milestones.filter((m, i) => i !== 0 && !(m.released || m.resolved || m.disputed));
  if (open.length > 0) {
    throw new Error(`milestones still open: ${open.map((m) => m.index).join(", ")} — release or dispute them first`);
  }
  process.stdout.write(`balance: ${before.balance} USDC, milestones: ${before.milestones.length}\n`);

  const close = before.milestones[0];
  if (close && !close.disputed && !close.released && !close.resolved) {
    if (!weAreFunder) throw new Error("close milestone not disputed yet: the funder must close the campaign in the app first");
    for (const u of await escrow.buildDispute(contractId, funder.publicKey(), [0])) {
      process.stdout.write(`dispute close milestone: ${(await escrow.submit(signWith(funder, u.unsignedXdr))).txHash}\n`);
    }
  }
  const now = await escrow.getEscrow(contractId);
  if (now.balance === "0") {
    process.stdout.write("nothing to sweep\n");
    return;
  }
  const sweep = await escrow.buildWithdrawRemaining(contractId, resolver.publicKey(), [
    { address: before.roles.funder, amount: now.balance },
  ]);
  const swept = await escrow.submit(signWith(resolver, sweep.unsignedXdr));
  process.stdout.write(`withdraw remaining → funder: ${swept.txHash}\n`);
  await recordInDb(contractId, swept.txHash);
  process.stdout.write(`balance after: ${(await escrow.getEscrow(contractId)).balance} USDC\n`);
}

main().catch((e) => {
  const details = typeof e === "object" && e && "details" in e ? JSON.stringify((e as { details: unknown }).details) : "";
  process.stderr.write(`close failed: ${e instanceof Error ? e.message : String(e)} ${details}\n`);
  process.exit(1);
});
