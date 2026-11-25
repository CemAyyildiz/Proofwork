import { env } from "@/config/env";
import { db } from "@/db/client";
import { requireUser } from "@/lib/current-user";
import { errorResponse } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { metricsCsv, metricsFilename, metricsOverview } from "@/services/metrics";

export const runtime = "nodejs";

/**
 * The metrics page as a CSV download, for the operator. No session is 401;
 * the `ops` role is checked in the service, so any other wallet is 403.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    await enforce(limiters.admin, `admin-metrics:${user.pubkey}`);
    const now = new Date();
    const overview = await metricsOverview(user, db, now);
    const network = env.STELLAR_NETWORK;
    // BOM so Excel reads the file as UTF-8 (Turkish characters in campaign titles).
    return new Response(`﻿${metricsCsv(overview, network, now)}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${metricsFilename(network, now)}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
