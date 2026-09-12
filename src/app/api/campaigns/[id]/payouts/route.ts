import { z } from "zod";
import { getEscrow } from "@/escrow";
import { requireUserRole } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { approveForPayout, confirmClose, confirmReleaseOp, prepareClose, prepareReleaseOp } from "@/services/payout";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), submissionIds: z.array(z.string().min(1)).min(1).max(50) }),
  z.object({ action: z.literal("prepare"), kind: z.enum(["release", "close"]) }),
  z.object({ action: z.literal("submit"), kind: z.enum(["release", "close"]), opId: z.string().min(1), signedXdr: z.string().min(1) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return jsonRoute(schema, async (input) => {
    const user = await requireUserRole("funder", id);
    const escrow = getEscrow();
    switch (input.action) {
      case "approve":
        return approveForPayout(id, input.submissionIds, user, escrow);
      case "prepare":
        return input.kind === "close" ? { ops: [await prepareClose(id, user, escrow)] } : { ops: await prepareReleaseOp(id, user, escrow) };
      case "submit": {
        const args = { campaignId: id, opId: input.opId, signedXdr: input.signedXdr };
        return input.kind === "close" ? confirmClose(args, user, escrow) : confirmReleaseOp(args, user, escrow);
      }
    }
  })(req);
}
