import { z } from "zod";
import { currentUser } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";

export const runtime = "nodejs";

export const GET = jsonRoute(z.object({}), async () => {
  const u = await currentUser();
  return u ? { pubkey: u.pubkey, roles: [...u.roles] } : { pubkey: null, roles: [] };
});
