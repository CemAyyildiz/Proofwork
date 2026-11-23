import { z } from "zod";
import { clientIp, jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { clearSessionCookie, readSession } from "@/lib/session";
import { revokeSessions } from "@/services/auth";

export const runtime = "nodejs";

export const POST = jsonRoute(z.object({}), async (_input, req) => {
  // Logout writes a revocation row, so it is limited per address like the rest of login.
  await enforce(limiters.authIp, `logout:ip:${clientIp(req)}`);
  const s = await readSession();
  if (s) await revokeSessions(s.pk);
  await clearSessionCookie();
  return { ok: true };
});
