import { StrKey } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { roleGrants } from "../src/db/schema";

/**
 * Operator tool: grant or revoke a global role for a wallet.
 *   pnpm role:grant <pubkey> <funder|reviewer|ops>
 *   pnpm role:grant <pubkey> <role> --revoke
 */
const [pubkey, role, flag] = process.argv.slice(2);
const roles = ["funder", "reviewer", "ops"] as const;
type Role = (typeof roles)[number];

function isRole(v: string | undefined): v is Role {
  return roles.includes(v as Role);
}

if (!pubkey || !StrKey.isValidEd25519PublicKey(pubkey) || !isRole(role)) {
  process.stderr.write("usage: pnpm role:grant <G...> <funder|reviewer|ops> [--revoke]\n");
  process.exit(2);
}
const url = process.env["DATABASE_URL"];
if (!url) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(2);
}

const client = postgres(url, { max: 1 });
const db = drizzle({ client });

async function main(): Promise<void> {
  if (flag === "--revoke") {
    await db.delete(roleGrants).where(eq(roleGrants.pubkey, pubkey as string));
    process.stdout.write(`revoked all roles for ${pubkey}\n`);
  } else {
    await db.insert(roleGrants).values({ pubkey: pubkey as string, role: role as Role, campaignId: null }).onConflictDoNothing();
    process.stdout.write(`granted ${role} to ${pubkey}\n`);
  }
  await client.end();
}

main().catch((e) => {
  process.stderr.write(`failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
