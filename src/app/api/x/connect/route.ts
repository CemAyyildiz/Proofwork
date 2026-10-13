import { cookies } from "next/headers";
import { returnPath } from "@/domain/x-connect";
import { currentUser } from "@/lib/current-user";
import { AppError, isAppError } from "@/lib/errors";
import { clientIp, errorResponse, redirectTo } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { readSession } from "@/lib/session";
import { connectQuerySchema, FLOW_COOKIE, flowCookieOptions, startConnect } from "@/services/x-account";
import { getX } from "@/x";

export const runtime = "nodejs";

/**
 * Starts Sign in with X for the session wallet. Reached by a plain link from
 * the campaign page, so every answer is a redirect: on to X, or back to the
 * campaign page with the reason.
 */
export async function GET(req: Request): Promise<Response> {
  const query = connectQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  // Without a valid slug there is no page to go back to.
  if (!query.success) return errorResponse(AppError.validation("invalid request"));
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
    if (isAppError(e) && e.code === "RATE_LIMITED") return redirectTo(returnPath(slug, "rate_limited"));
    return errorResponse(e);
  }
}
