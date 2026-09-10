import { z } from "zod";
import { requireUser } from "@/lib/current-user";
import { clientIp, jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { requestAppeal } from "@/services/review";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return jsonRoute(z.object({}), async (_input, r) => {
    const user = await requireUser();
    await enforce(limiters.appeal, `appeal:${clientIp(r)}:${user.pubkey}`);
    await requestAppeal(id, user);
    return { ok: true };
  })(req);
}
