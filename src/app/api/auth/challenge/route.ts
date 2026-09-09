import { z } from "zod";
import { pubkeySchema } from "@/domain/wallet-auth";
import { clientIp, jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { issueChallenge } from "@/services/auth";

export const runtime = "nodejs";

export const POST = jsonRoute(z.object({ pubkey: pubkeySchema }), async ({ pubkey }, req) => {
  await enforce(limiters.auth, `challenge:${clientIp(req)}:${pubkey}`);
  return issueChallenge(pubkey);
});
