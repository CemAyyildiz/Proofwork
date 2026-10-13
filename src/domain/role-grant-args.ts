import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { roleName } from "@/db/schema";

/**
 * Arguments of `pnpm role:grant`, parsed without I/O so the mapping from the
 * command line to a role change can be tested:
 *   <pubkey> <funder|reviewer|ops>            grant
 *   <pubkey> <funder|reviewer|ops> --revoke   revoke
 */
const argsSchema = z.object({
  pubkey: z.string({ error: "wallet public key is required" }).refine((v) => StrKey.isValidEd25519PublicKey(v), "not a Stellar public key (G...)"),
  role: z.enum(roleName.enumValues, { error: "role must be funder, reviewer or ops" }),
  flag: z.literal("--revoke", { error: "the only flag is --revoke" }).optional(),
});

export type RoleGrantArgs = { pubkey: string; role: (typeof roleName.enumValues)[number]; action: "grant" | "revoke" };

/** `argv` is what follows the script name. A leading `--`, as pnpm may pass it, is ignored. */
export function parseRoleGrantArgs(argv: readonly string[]): { ok: true; args: RoleGrantArgs } | { ok: false; message: string } {
  const rest = argv.filter((a, i) => !(i === 0 && a === "--"));
  if (rest.length > 3) return { ok: false, message: "expected at most three arguments" };
  const parsed = argsSchema.safeParse({ pubkey: rest[0], role: rest[1], flag: rest[2] });
  if (!parsed.success) return { ok: false, message: z.prettifyError(parsed.error) };
  return { ok: true, args: { pubkey: parsed.data.pubkey, role: parsed.data.role, action: parsed.data.flag ? "revoke" : "grant" } };
}

/** Host and database name of a connection string, to say which database a script is about to change. Never the user or password. */
export function databaseTarget(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
}
