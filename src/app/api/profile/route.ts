import { z } from "zod";
import { requireUser } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { dismissPrompt, profileSchema, saveProfile } from "@/services/profile";

export const runtime = "nodejs";

/** Saves the session wallet's profile. The body names no wallet; the session does. */
export const PUT = jsonRoute(profileSchema, async (input) => {
  const user = await requireUser();
  await enforce(limiters.profile, `profile:${user.pubkey}`);
  return { profile: await saveProfile(input, user) };
});

/** "Later" on the first sign-in prompt. */
export const POST = jsonRoute(z.object({ action: z.literal("later") }), async () => {
  const user = await requireUser();
  await enforce(limiters.profile, `profile:${user.pubkey}`);
  await dismissPrompt(user);
  return { ok: true };
});
