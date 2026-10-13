import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../src/db/schema";
import { databaseTarget } from "../src/domain/role-grant-args";
import { TrustlessWorkAdapter } from "../src/escrow/trustless-work/adapter";
import { TrustlessWorkClient } from "../src/escrow/trustless-work/client";
import { recordSweep, RemainderError, returnRemainder } from "../src/services/remainder";

/**
 * Operator tool: return a campaign escrow's remainder to its funder (AD-4).
 * The flow itself is `returnRemainder` in src/services/remainder.ts; this file
 * reads the arguments and the environment and turns the outcome into an exit
 * code.
 *
 *   pnpm escrow:close <contractId>                     sweep, and record it on the campaign in DATABASE_URL
 *   pnpm escrow:close <contractId> --no-record         sweep only; no database is opened
 *   pnpm escrow:close <contractId> --record <tx hash>  record a sweep that already happened; signs nothing
 *
 * The first two sign with DISPUTE_RESOLVER_SECRET. `--record` needs no
 * signing key at all, so a resolver can sweep with `--no-record` and the
 * operator can record the hash afterwards. FUNDER_SECRET is optional and only
 * has a use for an escrow that same key funded outside the app (the Week 1
 * spike): the close milestone is then disputed here. The platform keys are
 * not read: they sign nothing in this script.
 *
 * Exit codes: 0 done · 1 refused or failed with nothing returned · 2 bad
 * arguments or environment · 3 the escrow is empty and the campaign has no
 * remainder recorded · 4 the sweep went out and is not recorded.
 */
const seed = z.string().refine((v) => StrKey.isValidEd25519SecretSeed(v), "must be a Stellar secret seed (S...)");
/** `.env` templates leave unset values as empty strings; treat those as unset. */
const optional = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), inner.optional());
const envSchema = z.object({
  TW_BASE_URL: z.string().url().default("https://dev.api.trustlesswork.com"),
  TW_API_KEY: z.string().min(16),
  USDC_ISSUER: z.string().default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
  DISPUTE_RESOLVER_SECRET: optional(seed),
  FUNDER_SECRET: optional(seed),
  DATABASE_URL: optional(z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// or postgresql:// URL" })),
});

const contract = z.string({ error: "an escrow contract ID is required" }).refine((v) => StrKey.isValidContract(v), "the first argument must be an escrow contract ID (C...)");
const argsSchema = z.union([
  z.tuple([contract]).transform(([contractId]) => ({ contractId, mode: "sweep" as const })),
  z.tuple([contract, z.literal("--no-record")]).transform(([contractId]) => ({ contractId, mode: "sweep-only" as const })),
  z
    .tuple([contract, z.literal("--record"), z.string().regex(/^[0-9a-f]{64}$/, "the transaction hash must be 64 lowercase hex characters")])
    .transform(([contractId, , txHash]) => ({ contractId, mode: "record" as const, txHash })),
]);

const USAGE = "usage: pnpm escrow:close <contractId> [--no-record | --record <tx hash>]";

function exit(code: 1 | 2 | 3 | 4, message: string): never {
  process.stderr.write(`${message}\n`);
  if (code === 2) process.stderr.write(`${USAGE}\n`);
  process.exit(code);
}

const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  const args = argsSchema.safeParse(argv);
  if (!args.success) exit(2, "close failed: expected a contract ID (C...), then nothing, --no-record, or --record and a 64-character transaction hash");
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) exit(2, `close failed: invalid environment\n${z.prettifyError(parsed.error)}`);
  const env = parsed.data;
  const { contractId, mode } = args.data;

  const escrow = new TrustlessWorkAdapter({
    client: new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY),
    usdcIssuer: env.USDC_ISSUER,
    // The adapter is built with the two platform keys for the server-signed operations. Nothing here
    // uses them, so whoever holds the resolver key does not have to hold those: throwaway keys stand in.
    platformAdmin: Keypair.random(),
    platformOps: Keypair.random(),
  });

  // Only --no-record runs without a database; an unset DATABASE_URL never means that by itself.
  const url = mode === "sweep-only" ? undefined : env.DATABASE_URL;
  if (mode === "record" && !url) exit(2, "close failed: --record needs DATABASE_URL set to the app's database");
  if (mode === "sweep" && !url) {
    exit(2, "close failed: DATABASE_URL is not set, so the sweep could not be recorded on its campaign. Set it to the app's database, or pass --no-record to sweep without recording");
  }
  const resolverSecret = env.DISPUTE_RESOLVER_SECRET;
  if (mode !== "record" && !resolverSecret) exit(2, "close failed: DISPUTE_RESOLVER_SECRET is not set");

  const client = url ? postgres(url, { max: 1, prepare: false }) : null;
  const conn = client ? drizzle({ client, schema }) : null;
  say(url ? `database: ${databaseTarget(url)}` : "--no-record: the sweep will not be recorded on a campaign");
  try {
    if (args.data.mode === "record") {
      if (!conn) exit(2, "close failed: --record needs DATABASE_URL");
      await recordSweep({ contractId, txHash: args.data.txHash, say }, escrow, conn);
      return;
    }
    if (!resolverSecret) exit(2, "close failed: DISPUTE_RESOLVER_SECRET is not set");
    const resolver = Keypair.fromSecret(resolverSecret);
    const ownFunder = env.FUNDER_SECRET ? Keypair.fromSecret(env.FUNDER_SECRET) : null;
    const result = await returnRemainder({ contractId, signers: { resolver, ownFunder }, say }, escrow, conn);
    if (result.outcome === "nothing") {
      say(result.recordedTxHash ? `nothing to sweep: remainder ${result.recordedTxHash} is already recorded` : "nothing to sweep: the escrow is empty");
    } else if (!result.recorded) {
      say(`swept and not recorded. The operator records it with: pnpm escrow:close ${contractId} --record ${result.txHash}`);
    }
  } finally {
    await client?.end();
  }
}

main().catch((e) => {
  const contractId = process.argv.slice(2).find((a) => StrKey.isValidContract(a)) ?? "<contractId>";
  if (e instanceof RemainderError && e.kind === "swept_unrecorded") {
    exit(4, `swept, not recorded: ${e.message}.\nsweep transaction: ${e.txHash}\nCheck it on the explorer, then record it with: pnpm escrow:close ${contractId} --record ${e.txHash}`);
  }
  if (e instanceof RemainderError && e.kind === "empty_unrecorded") {
    exit(3, `not recorded: ${e.message}. If it was swept, find the withdrawal on the escrow's explorer page and record it with: pnpm escrow:close ${contractId} --record <tx hash>`);
  }
  const details = typeof e === "object" && e && "details" in e && e.details ? ` ${JSON.stringify((e as { details: unknown }).details)}` : "";
  exit(1, `close failed: ${e instanceof Error ? e.message : String(e)}${details}`);
});
