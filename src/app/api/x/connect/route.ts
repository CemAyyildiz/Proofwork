import { cookies } from "next/headers";
import { noCampaignPath, returnPath } from "@/domain/x-connect";
import { currentUser } from "@/lib/current-user";
import { clientIp, redirectTo } from "@/lib/http";
import { log } from "@/lib/logger";
import { enforce, limiters } from "@/lib/ratelimit";
import { readSession } from "@/lib/session";
import { connectQuerySchema, failedOutcome, FLOW_COOKIE, flowCookieOptions, startConnect } from "@/services/x-account";
import { getX } from "@/x";

export const runtime = "nodejs";

/**
 * Starts Sign in with X for the session wallet. Reached by a plain link from
 * the campaign page, so every answer is a redirect, never JSON: on to X, back
 * to the campaign page with the reason, or to the campaign list when the
 * request names no campaign.
 */
export async function GET(req: Request): Promise<Response> {
  const query = connectQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) {
    log.warn("x connect without a campaign slug");
    return redirectTo(noCampaignPath("retry"));
  }
  const { slug } = query.data;

  try {
    // The cookie alone names the wallet for the limit key; the database is asked only after the limit.
    const session = await readSession();
    await enforce(limiters.x, `x-connect:${clientIp(req)}:${session?.pk ?? "anon"}`);
    const user = await currentUser();
    const started = startConnect({ pubkey: user?.pubkey ?? null, slug, x: getX() });
    if (started.to === "campaign") return redirectTo(returnPath(slug, started.outcome));
    (await cookies()).set(FLOW_COOKIE, started.flowToken, flowCookieOptions());
    return redirectTo(started.url);
  } catch (e) {
    return redirectTo(returnPath(slug, failedOutcome("connect", e)));
  }
}
