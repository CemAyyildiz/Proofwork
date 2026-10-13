import { StrKey } from "@stellar/stellar-sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../src/db/schema";
import { changeRole } from "../src/services/access";

/**
 * Operator tool: grant or revoke one global role for a wallet.
 *   pnpm role:grant <pubkey> <funder|reviewer|ops>
 *   pnpm role:grant <pubkey> <role> --revoke
 * The change goes through `changeRole`, so it is written to the access log
 * marked as coming from the script. Only the named role is touched.
 */
const argsSchema = z.object({
  pubkey: z.string({ error: "wallet public key is required" }).refine((v) => StrKey.isValidEd25519PublicKey(v), "not a Stellar public key (G...)"),
  role: z.enum(schema.roleName.enumValues, { error: "role must be funder, reviewer or ops" }),
  flag: z.literal("--revoke", { error: "the only flag is --revoke" }).optional(),
});
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL must be a postgres:// or postgresql:// URL" }),
});

function fail(message: string): never {
  process.stderr.write(`role:grant: ${message}\n`);
  process.stderr.write("usage: pnpm role:grant <G...> <funder|reviewer|ops> [--revoke]\n");
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  if (argv.length > 3) fail("expected at most three arguments");
  const args = argsSchema.safeParse({ pubkey: argv[0], role: argv[1], flag: argv[2] });
  if (!args.success) fail(z.prettifyError(args.error));
  const env = envSchema.safeParse(process.env);
  if (!env.success) fail(z.prettifyError(env.error));

  const { pubkey, role } = args.data;
  const action = args.data.flag ? "revoke" : "grant";
  const client = postgres(env.data.DATABASE_URL, { max: 1, prepare: false });
  try {
    const changed = await changeRole({ pubkey, role, action }, { via: "script" }, drizzle({ client, schema }));
    if (changed) process.stdout.write(`${action === "grant" ? "granted" : "revoked"} ${role} for ${pubkey}; access log entry written\n`);
    else process.stdout.write(`${pubkey} ${action === "grant" ? "already has" : "does not have"} ${role}; nothing changed, no log entry\n`);
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`role:grant: failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}\n`);
  process.exit(1);
});
