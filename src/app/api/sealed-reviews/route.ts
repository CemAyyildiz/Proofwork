import { z } from "zod";
import { sealedDualReviewEnabled } from "@/config/env";
import { getLedger } from "@/escrow";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import {
  finalizeSealedReview,
  prepareSealedReview,
  recordSealedClear,
  recordSealedCommit,
  recordSealedReveal,
  registerSealedReview,
  sealedReviewActionSchema,
  sealedReviewList,
} from "@/services/sealed-review";

export const runtime = "nodejs";

function enabled(): void {
  if (!sealedDualReviewEnabled()) throw AppError.notFound("sealed dual review");
}

export const GET = jsonRoute(z.object({}), async () => {
  enabled();
  const user = await requireUser();
  return sealedReviewList(user);
});

export const POST = jsonRoute(sealedReviewActionSchema, async (input) => {
  enabled();
  const user = await requireUser();
  await enforce(limiters.review, `sealed-review:${user.pubkey}`);
  switch (input.action) {
    case "prepare": {
      const round = await prepareSealedReview(input, user);
      return { round };
    }
    case "register":
      await registerSealedReview(input, user);
      return { ok: true };
    case "commit":
      await recordSealedCommit(input, user);
      return { ok: true };
    case "reveal":
      await recordSealedReveal(input, user);
      return { ok: true };
    case "clear":
      return recordSealedClear(input, user);
    case "finalize":
      return finalizeSealedReview(input, user, getLedger());
  }
});
