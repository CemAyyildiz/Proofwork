import { getLedger } from "@/escrow";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { decide, decideSchema } from "@/services/review";

export const runtime = "nodejs";

export const POST = jsonRoute(decideSchema, async (input) => {
  const user = await requireUser();
  // Every well-formed request is counted per session wallet, before the role check.
  await enforce(limiters.review, `review:${user.pubkey}`);
  if (!user.roles.has("reviewer")) throw AppError.forbidden("requires reviewer role");
  const d = await decide(input, user, getLedger());
  return { id: d.id, outcome: d.outcome, reasonCode: d.reasonCode, txHash: d.txHash, ledgerKey: d.ledgerKey };
});
