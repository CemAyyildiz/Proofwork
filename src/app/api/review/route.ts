import { ledger } from "@/escrow";
import { requireUserRole } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { decide, decideSchema } from "@/services/review";

export const runtime = "nodejs";

export const POST = jsonRoute(decideSchema, async (input) => {
  const user = await requireUserRole("reviewer");
  const d = await decide(input, user, ledger);
  return { id: d.id, outcome: d.outcome, reasonCode: d.reasonCode, txHash: d.txHash, ledgerKey: d.ledgerKey };
});
