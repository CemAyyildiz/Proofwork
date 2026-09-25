import { z } from "zod";
import { toCsv } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/current-user";
import { errorResponse } from "@/lib/http";
import { REVIEW_LOG_COLUMNS, reviewLog } from "@/services/review";

export const runtime = "nodejs";

const schema = z.object({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  format: z.enum(["csv", "json"]).default("csv"),
});

/** Review log export for reviewers and the campaign's funder; see `reviewLog`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const format = new URL(req.url).searchParams.get("format") ?? undefined;
    const parsed = schema.safeParse({ id, format });
    if (!parsed.success) {
      throw AppError.validation("invalid request", { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
    }
    const user = await requireUser(parsed.data.id);
    const { campaign, rows } = await reviewLog(parsed.data.id, user);
    const headers = { "Cache-Control": "no-store" };
    if (parsed.data.format === "json") {
      return Response.json(rows, { headers });
    }
    // BOM so Excel reads the file as UTF-8 (Turkish characters in notes).
    return new Response(`\uFEFF${toCsv(REVIEW_LOG_COLUMNS, rows)}`, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="review-log-${campaign.slug}.csv"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
