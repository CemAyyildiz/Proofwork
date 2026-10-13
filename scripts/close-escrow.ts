import { Keypair, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../src/db/schema";
import type { Campaign } from "../src/db/schema";
import { databaseTarget } from "../src/domain/role-grant-args";
import { toStroops } from "../src/escrow/amount";
import { TrustlessWorkAdapter } from "../src/escrow/trustless-work/adapter";
import { TrustlessWorkClient } from "../src/escrow/trustless-work/client";
import { isAppError } from "../src/lib/errors";
import { campaignForEscrow, recordRemainder } from "../src/services/payout";

/**
 * Operator tool: return a campaign escrow's remainder to its funder (AD-4).
 * Sweeps the whole balance to the escrow's own funder with the dispute
 * resolver key. Refuses if any reward milestone is still open.
 *
 *   pnpm escrow:close <contractId>
 *
 * The funder must have closed the campaign in the app first. The one
 * exception is a campaign funded with the key in FUNDER_SECRET, as in the
 * Week 1 spike: this script then disputes the close milestone itself.
 * FUNDER_SECRET is optional and has no use for any other funder.
 *
 * With DATABASE_URL set, the campaign that owns the escrow is looked up
 * before anything is signed, and the sweep is recorded on it once the escrow
 * reads back empty. A database that does not know the escrow stops the run:
 * a sweep cannot be repeated to record it later. Leave DATABASE_URL empty to
 * sweep without recording.
 */
const seed = z.string().refine((v) => StrKey.isValidEd25519SecretSeed(v), "must be a Stellar secret seed (S...)");
/** `.env` templates leave unset values as empty strings; treat those as unset. */
const optional = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), inner.optional());
const envSchema = z.object({
  TW_BASE_URL: z.string().url().default("https://dev.api.trustlesswork.com"),
  TW_API_KEY: z.string().min(16),
  USDC_ISSUER: z.string().default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
  PLATFORM_ADMIN_SECRET: seed,
  PLATFORM_OPS_SECRET: seed,
  DISPUTE_RESOLVER_SECRET: seed,
  FUNDER_SECRET: optional(seed),
  DATABASE_URL: optional(z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// or postgresql:// URL" })),
});

function fail(message: string, code: 1 | 2 = 1): never {
  process.stderr.write(`close failed: ${message}\n`);
  if (code === 2) process.stderr.write("usage: pnpm escrow:close <contractId>\n");
  process.exit(code);
}

function signWith(kp: Keypair, unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(kp);
  return tx.toXDR();
}

async function main(): Promise<void> {
  const contractId = process.argv[2];
  if (!contractId || !StrKey.isValidContract(contractId)) fail("the argument must be an escrow contract ID (C...)", 2);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) fail(`invalid environment\n${z.prettifyError(parsed.error)}`);
  const env = parsed.data;

  const resolver = Keypair.fromSecret(env.DISPUTE_RESOLVER_SECRET);
  const ownFunder = env.FUNDER_SECRET ? Keypair.fromSecret(env.FUNDER_SECRET) : null;
  const escrow = new TrustlessWorkAdapter({
    client: new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY),
    usdcIssuer: env.USDC_ISSUER,
    platformAdmin: Keypair.fromSecret(env.PLATFORM_ADMIN_SECRET),
    platformOps: Keypair.fromSecret(env.PLATFORM_OPS_SECRET),
  });

  const before = await escrow.getEscrow(contractId);
  if (before.roles.disputeResolver !== resolver.publicKey()) {
    throw new Error("escrow disputeResolver is not the configured DISPUTE_RESOLVER_SECRET key");
  }
  const funder = before.roles.funder;
  const open = before.milestones.filter((m, i) => i !== 0 && !(m.released || m.resolved || m.disputed));
  if (open.length > 0) {
    throw new Error(`milestones still open: ${open.map((m) => m.index).join(", ")} — release or dispute them first`);
  }
  process.stdout.write(`balance: ${before.balance} USDC, milestones: ${before.milestones.length}\n`);
  process.stdout.write(`escrow funder: ${funder} (the remainder goes to this address)\n`);

  const target = env.DATABASE_URL ? databaseTarget(env.DATABASE_URL) : null;
  const client = env.DATABASE_URL ? postgres(env.DATABASE_URL, { max: 1, prepare: false }) : null;
  const conn = client ? drizzle({ client, schema }) : null;
  try {
    // Before anything is signed: the campaign this sweep will be recorded on.
    let campaign: Campaign | null = null;
    if (conn && target) {
      process.stdout.write(`database: ${target}\n`);
      try {
        campaign = await campaignForEscrow(contractId, conn);
      } catch (e) {
        if (!isAppError(e) || e.code !== "NOT_FOUND") throw e;
        throw new Error(
          `no campaign with this escrow in ${target}; nothing was signed. Point DATABASE_URL at the app's database, or set it empty to sweep without recording`,
        );
      }
      if (campaign.funderPubkey !== funder) {
        throw new Error(`campaign ${campaign.slug} has another funder in the database than the escrow has on chain; nothing was signed`);
      }
      process.stdout.write(`campaign: ${campaign.slug}\n`);
    } else {
      process.stdout.write("no DATABASE_URL: the sweep will not be recorded on a campaign\n");
    }

    const close = before.milestones[0];
    if (close && !close.disputed && !close.released && !close.resolved) {
      if (!ownFunder || ownFunder.publicKey() !== funder) {
        throw new Error("close milestone not disputed yet: the funder must close the campaign in the app first");
      }
      for (const u of await escrow.buildDispute(contractId, funder, [0])) {
        process.stdout.write(`dispute close milestone: ${(await escrow.submit(signWith(ownFunder, u.unsignedXdr))).txHash}\n`);
      }
    }
    const now = await escrow.getEscrow(contractId);
    if (toStroops(now.balance) === 0n) {
      process.stdout.write("nothing to sweep\n");
      return;
    }
    const sweep = await escrow.buildWithdrawRemaining(contractId, resolver.publicKey(), [{ address: funder, amount: now.balance }]);
    const swept = await escrow.submit(signWith(resolver, sweep.unsignedXdr));
    process.stdout.write(`withdraw remaining → funder: ${swept.txHash}\n`);

    // The chain decides: the hash is recorded only once the escrow reads back empty.
    const after = await escrow.getEscrow(contractId);
    process.stdout.write(`balance after: ${after.balance} USDC\n`);
    if (toStroops(after.balance) !== 0n) {
      throw new Error(`the escrow still holds ${after.balance} USDC after ${swept.txHash}; nothing was recorded`);
    }
    if (campaign && conn) {
      await recordRemainder(campaign.id, swept.txHash, conn);
      process.stdout.write(`recorded remainder on campaign ${campaign.slug}\n`);
    }
  } finally {
    await client?.end();
  }
}

main().catch((e) => {
  const details = typeof e === "object" && e && "details" in e && e.details ? ` ${JSON.stringify((e as { details: unknown }).details)}` : "";
  fail(`${e instanceof Error ? e.message : String(e)}${details}`);
});
