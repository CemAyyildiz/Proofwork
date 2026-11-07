import { z } from "zod";
import { sealedDualReviewEnabled } from "@/config/env";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { sealedReviewView } from "@/services/sealed-review";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    if (!sealedDualReviewEnabled()) throw AppError.notFound("sealed dual review");
    const user = await requireUser();
    const parsed = z.string().min(1).safeParse((await params).id);
    if (!parsed.success) throw AppError.validation("invalid sealed review id");
    return Response.json(await sealedReviewView(parsed.data, user));
  } catch (error) {
    return errorResponse(error);
  }
}
