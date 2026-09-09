import { z } from "zod";
import { jsonRoute } from "@/lib/http";
import { clearSessionCookie, readSession } from "@/lib/session";
import { revokeSessions } from "@/services/auth";

export const runtime = "nodejs";

export const POST = jsonRoute(z.object({}), async () => {
  const s = await readSession();
  if (s) await revokeSessions(s.pk);
  await clearSessionCookie();
  return { ok: true };
});
