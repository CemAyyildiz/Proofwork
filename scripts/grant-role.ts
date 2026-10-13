import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../src/db/schema";
import { databaseTarget, parseRoleGrantArgs } from "../src/domain/role-grant-args";
import { changeRole } from "../src/services/access";

/**
 * Operator tool: grant or revoke one global role for a wallet.
 *   pnpm role:grant <pubkey> <funder|reviewer|ops>
 *   pnpm role:grant <pubkey> <role> --revoke
 * The change goes through `changeRole`, so it is written to the access log
 * marked as coming from the script. Only the named role is touched.
 */
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL must be a postgres:// or postgresql:// URL" }),
});

function fail(message: string): never {
  process.stderr.write(`role:grant: ${message}\n`);
  process.stderr.write("usage: pnpm role:grant <G...> <funder|reviewer|ops> [--revoke]\n");
  process.exit(2);
}

async function main(): Promise<void> {
  const parsed = parseRoleGrantArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.message);
  const env = envSchema.safeParse(process.env);
  if (!env.success) fail(z.prettifyError(env.error));

  const { pubkey, role, action } = parsed.args;
  process.stdout.write(`database: ${databaseTarget(env.data.DATABASE_URL)}\n`);
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
