import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../src/db/schema";
import { AppError } from "../src/lib/errors";
import { loadCampaignEvidence, renderCampaignEvidence } from "../src/services/evidence";

/**
 * Writes every on-chain tx of one campaign to docs/evidence/campaign.md.
 *   pnpm evidence:dump <campaign-slug>
 * Reads the app database (DATABASE_URL) only; no network beyond it.
 */
const argsSchema = z.object({
  slug: z
    .string({ error: "campaign slug is required" })
    .regex(/^[a-z0-9_-]{1,64}$/, "campaign slug must be 1-64 characters of a-z, 0-9, - or _"),
});
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL must be a postgres:// or postgresql:// URL" }),
});

const SITE_URL = "https://proofwork.online";
const OUT = resolve(import.meta.dirname, "..", "docs", "evidence", "campaign.md");

function fail(message: string): never {
  process.stderr.write(`evidence:dump: ${message}\n`);
  process.stderr.write("usage: pnpm evidence:dump <campaign-slug>\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  if (argv.length > 1) fail("expected exactly one argument");
  const args = argsSchema.safeParse({ slug: argv[0] });
  if (!args.success) fail(z.prettifyError(args.error));
  const env = envSchema.safeParse(process.env);
  if (!env.success) fail(z.prettifyError(env.error));

  const client = postgres(env.data.DATABASE_URL, { max: 1, prepare: false });
  try {
    const conn = drizzle({ client, schema });
    const evidence = await loadCampaignEvidence(conn, args.data.slug);
    writeFileSync(OUT, renderCampaignEvidence(evidence, { siteUrl: SITE_URL, generatedAt: new Date() }));
    process.stdout.write(`wrote ${OUT}\n`);
  } catch (e) {
    if (e instanceof AppError) fail(e.message);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  const c = e instanceof Error ? e.cause : undefined;
  const code = c && typeof c === "object" && "code" in c ? String(c.code) : "";
  const cause = c instanceof Error ? ` (${c.message || code || c.name})` : "";
  fail(`${e instanceof Error ? e.message.split("\n")[0] : String(e)}${cause}`);
});
