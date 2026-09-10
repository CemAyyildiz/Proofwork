import { z } from "zod";
import { requireUser } from "@/lib/current-user";
import { clientIp, jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { createSubmission } from "@/services/submission";

export const runtime = "nodejs";

const schema = z.object({
  campaignSlug: z.string().min(1).max(80),
  workUrl: z.string().min(1).max(300),
});

export const POST = jsonRoute(schema, async (input, req) => {
  const user = await requireUser();
  await enforce(limiters.submit, `submit:${clientIp(req)}:${user.pubkey}`);
  const s = await createSubmission(input, user);
  return { id: s.id, shortId: s.shortId, workUrl: s.workUrl };
});
