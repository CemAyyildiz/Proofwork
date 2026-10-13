import { db } from "@/db/client";
import { requireUser } from "@/lib/current-user";
import { clientIp, jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { funderRequestSchema, requestFunderAccess } from "@/services/access";

export const runtime = "nodejs";

/** A signed-in wallet asks for funder access. The operator decides on the admin page. */
export const POST = jsonRoute(funderRequestSchema, async (input, req) => {
  const user = await requireUser();
  await enforce(limiters.access, `access:${clientIp(req)}:${user.pubkey}`);
  // And by wallet alone, so changing IPs does not reset the count.
  await enforce(limiters.access, `access:wallet:${user.pubkey}`);
  const r = await requestFunderAccess(input, user, db);
  return { id: r.id, status: r.status };
});
