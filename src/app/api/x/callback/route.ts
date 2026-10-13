import { cookies } from "next/headers";
import { noCampaignPath, returnPath, type XOutcome } from "@/domain/x-connect";
import { currentUser } from "@/lib/current-user";
import { clientIp, redirectTo } from "@/lib/http";
import { log } from "@/lib/logger";
import { enforce, limiters } from "@/lib/ratelimit";
import { readSession } from "@/lib/session";
import { callbackQuerySchema, failedOutcome, finishConnect, FLOW_COOKIE, flowCookieOptions, flowSlug } from "@/services/x-account";
import { getX } from "@/x";

export const runtime = "nodejs";

/** Back to the campaign the flow started on, or to the campaign list when no cookie of ours names one. */
function back(slug: string | null, outcome: XOutcome): Response {
  return redirectTo(slug ? returnPath(slug, outcome) : noCampaignPath(outcome));
}

/**
 * X sends the contributor back here, by navigation, so every answer is a
 * redirect, never JSON. The flow cookie is cleared whatever happens next, so
 * the same callback opened again in that browser finds no flow state. That is
 * the only way a flow is spent: the server keeps no record of used flows, and
 * a concurrent or replayed request still carrying the cookie would reach X,
 * where the single-use authorization code stops it.
 */
export async function GET(req: Request): Promise<Response> {
  let flowToken: string | undefined;
  try {
    const jar = await cookies();
    flowToken = jar.get(FLOW_COOKIE)?.value;
    jar.set(FLOW_COOKIE, "", { ...flowCookieOptions(), maxAge: 0 });

    const session = await readSession();
    await enforce(limiters.x, `x-callback:${clientIp(req)}:${session?.pk ?? "anon"}`);
    const query = callbackQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    const user = await currentUser();
    const { slug, outcome } = await finishConnect({
      pubkey: user?.pubkey ?? null,
      flowToken,
      // A query that fails the schema carries no usable state: the flow is refused.
      query: query.success ? query.data : {},
      x: getX(),
    });
    // Typical cause: X sent the contributor back to another browser than the one that started.
    if (slug === null) log.warn("x callback without a usable flow cookie", { outcome });
    return back(slug, outcome);
  } catch (e) {
    const outcome = failedOutcome("callback", e);
    let slug: string | null = null;
    try {
      slug = flowSlug(flowToken);
    } catch {
      // Reading the cookie needs the environment too; if that is what failed, there is no campaign to name.
    }
    return back(slug, outcome);
  }
}
