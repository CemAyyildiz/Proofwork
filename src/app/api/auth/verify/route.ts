import { z } from "zod";
import { pubkeySchema } from "@/domain/wallet-auth";
import { clientIp, jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { setSessionCookie } from "@/lib/session";
import { consumeChallenge, rolesFor } from "@/services/auth";

export const runtime = "nodejs";

const schema = z.object({
  pubkey: pubkeySchema,
  nonce: z.string().min(16).max(64),
  signature: z.string().min(64).max(128),
});

export const POST = jsonRoute(schema, async (input, req) => {
  await enforce(limiters.auth, `verify:${clientIp(req)}:${input.pubkey}`);
  const { pubkey } = await consumeChallenge(input);
  await setSessionCookie(pubkey);
  return { pubkey, roles: [...(await rolesFor(pubkey, null))] };
});
