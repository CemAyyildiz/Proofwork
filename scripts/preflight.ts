import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { env, funderLimits, xConfig } from "../src/config/env";
import { db } from "../src/db/client";
import { preflight } from "../src/domain/preflight";
import { getPlatformKeys } from "../src/escrow";
import { TrustlessWorkClient } from "../src/escrow/trustless-work/client";
import { readFunderAccount } from "../src/wallet/onboarding";

/**
 * Operator tool: check a deployment's environment before it takes a campaign.
 *
 *   pnpm preflight
 *
 * Reads the same environment the app reads (`.env` here; on a host, run it
 * with that host's values). It signs nothing and writes nothing: it reads the
 * server accounts on Horizon, asks Trustless Work whether the API key is
 * accepted, and counts the migrations and campaigns in the database. The checks are
 * `preflight` in src/domain/preflight.ts.
 *
 * Exit codes: 0 every check passed (WARN lines included) · 1 at least one
 * failed · 2 the environment itself was refused.
 */
async function main(): Promise<number> {
  let keys;
  try {
    keys = getPlatformKeys();
  } catch (e) {
    process.stderr.write(`preflight: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const journal = JSON.parse(readFileSync(new URL("../src/db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: unknown[] };
  const lines = await preflight({
    network: env.STELLAR_NETWORK,
    serverAccounts: keys,
    resolver: env.DEFAULT_DISPUTE_RESOLVER_PUBKEY,
    xConfigured: xConfig() !== null,
    rateLimitConfigured: env.UPSTASH_REDIS_REST_URL !== undefined && env.UPSTASH_REDIS_REST_TOKEN !== undefined,
    limits: funderLimits(),
    publicFundingSources: env.PUBLIC_FUNDING_SOURCES ?? [],
    spendableXlm: async (pubkey) => {
      const a = await readFunderAccount(pubkey, { horizonUrl: env.HORIZON_URL, usdcIssuer: env.USDC_ISSUER });
      return a.kind === "account" ? a.xlm.spendable : null;
    },
    trustlessWork: () => new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY).checkKey(keys.admin),
    migrations: async () => {
      const rows = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      return { applied: Number((rows[0] as { n: number } | undefined)?.n ?? 0), expected: journal.entries.length };
    },
    campaignCount: async () => {
      const rows = await db.execute(sql`select count(*)::int as n from campaign`);
      return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
    },
  });
  for (const line of lines) process.stdout.write(`${!line.ok ? "FAIL" : line.warn ? "WARN" : "ok  "}  ${line.text}\n`);
  return lines.every((l) => l.ok) ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`preflight: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  });
