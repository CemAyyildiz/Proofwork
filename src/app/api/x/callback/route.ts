import { cookies } from "next/headers";
import { returnPath, type XOutcome } from "@/domain/x-connect";
import { currentUser } from "@/lib/current-user";
import { isAppError } from "@/lib/errors";
import { clientIp, errorResponse, redirectTo } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { readSession } from "@/lib/session";
import { callbackQuerySchema, finishConnect, FLOW_COOKIE, flowCookieOptions, flowSlug } from "@/services/x-account";
import { getX } from "@/x";

export const runtime = "nodejs";

/** Where a callback goes when no cookie of ours says which campaign started it. */
const NO_CAMPAIGN_PATH = "/explore";

function back(slug: string | null, outcome: XOutcome): Response {
  return redirectTo(slug ? returnPath(slug, outcome) : NO_CAMPAIGN_PATH);
}

/**
 * X sends the contributor back here. The flow cookie is spent on arrival,
 * whatever happens next, so the same callback opened again finds no flow
 * state and X is not called a second time.
 */
export async function GET(req: Request): Promise<Response> {
  const jar = await cookies();
  const flowToken = jar.get(FLOW_COOKIE)?.value;
  jar.set(FLOW_COOKIE, "", { ...flowCookieOptions(), maxAge: 0 });

  try {
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
    return back(slug, outcome);
  } catch (e) {
    if (isAppError(e) && e.code === "RATE_LIMITED") return back(flowSlug(flowToken), "rate_limited");
    return errorResponse(e);
  }
}
