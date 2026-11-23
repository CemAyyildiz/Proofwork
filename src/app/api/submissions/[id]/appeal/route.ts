import { z } from "zod";
import { requireUser } from "@/lib/current-user";
import { clientIp, jsonRoute, parseRouteId } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { requestAppeal } from "@/services/review";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: rawId } = await ctx.params;
  return jsonRoute(z.object({}), async (_input, r) => {
    const id = parseRouteId(rawId);
    const user = await requireUser();
    await enforce(limiters.appeal, `appeal:${clientIp(r)}:${user.pubkey}`);
    // Per wallet as well, so a wallet that changes IP gets no fresh allowance.
    await enforce(limiters.appeal, `appeal:wallet:${user.pubkey}`);
    await requestAppeal(id, user);
    return { ok: true };
  })(req);
}
