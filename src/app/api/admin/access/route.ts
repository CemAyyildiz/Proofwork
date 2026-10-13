import { z } from "zod";
import { db } from "@/db/client";
import { pubkeySchema } from "@/domain/wallet-auth";
import { requireUser } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { decideRequest, revokeFunder } from "@/services/access";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["approve", "reject"]), requestId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) }),
  z.object({ action: z.literal("revoke"), pubkey: pubkeySchema }),
]);

/**
 * Operator decisions on funder access. The `ops` role is checked in the
 * service against the session wallet; nothing here trusts the caller.
 */
export const POST = jsonRoute(schema, async (input) => {
  const user = await requireUser();
  if (input.action === "revoke") return revokeFunder(input.pubkey, user, db);
  const r = await decideRequest({ requestId: input.requestId, decision: input.action }, user, db);
  return { id: r.id, status: r.status };
});
