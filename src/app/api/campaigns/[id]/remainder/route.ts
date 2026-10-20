import { z } from "zod";
import { getEscrow } from "@/escrow";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { confirmRemainderReturn, prepareRemainderReturn } from "@/services/remainder-op";

export const runtime = "nodejs";

const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({ action: z.literal("submit"), opId: z.string().min(1).max(64), signedXdr: z.string().min(1).max(20_000) }),
]);

/**
 * The remainder return, by the campaign's dispute resolver in its own wallet.
 * `prepare` returns the unsigned `withdraw-remaining-funds` XDR with the
 * amount and receiver read from chain; `submit` takes it back signed. The
 * service checks that the session wallet is the campaign's resolver; nothing
 * here trusts the caller.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: rawId } = await ctx.params;
  return jsonRoute(schema, async (input) => {
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw AppError.validation("invalid request", { issues: parsedId.error.issues.map((i) => ({ path: ["id", ...i.path], message: i.message })) });
    }
    const id = parsedId.data;
    const user = await requireUser();
    await enforce(limiters.admin, `remainder:${user.pubkey}`);
    const escrow = getEscrow();
    if (input.action === "prepare") return prepareRemainderReturn(id, user, escrow);
    return confirmRemainderReturn({ campaignId: id, opId: input.opId, signedXdr: input.signedXdr }, user, escrow);
  })(req);
}
