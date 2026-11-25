import { z } from "zod";
import { pubkeySchema } from "@/domain/wallet-auth";
import { clientIp, jsonRoute, requestHost } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { setSessionCookie } from "@/lib/session";
import { consumeChallenge, needsProfile, rolesFor } from "@/services/auth";

export const runtime = "nodejs";

const schema = z.object({
  pubkey: pubkeySchema,
  nonce: z.string().min(16).max(64),
  signature: z.string().min(64).max(128),
});

export const POST = jsonRoute(schema, async (input, req) => {
  await enforce(limiters.auth, `verify:${clientIp(req)}:${input.pubkey}`);
  await enforce(limiters.authIp, `verify:ip:${clientIp(req)}`);
  const { pubkey } = await consumeChallenge(input, requestHost(req));
  // Read everything the answer needs first: a failed read must not leave a session cookie behind a login error.
  const roles = [...(await rolesFor(pubkey, null))];
  const prompt = await needsProfile(pubkey);
  await setSessionCookie(pubkey);
  return { pubkey, roles, needsProfile: prompt };
});
