import { z } from "zod";
import { getEscrow } from "@/escrow";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { jsonRoute } from "@/lib/http";
import { canManageCampaign } from "@/services/access";
import { getCampaignById } from "@/services/campaign";
import { approveForPayout, confirmClose, confirmReleaseOp, prepareClose, prepareReleaseOp } from "@/services/payout";

export const runtime = "nodejs";

const submissionIds = z.array(z.string().min(1)).min(1).max(50);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), submissionIds }),
  // A release is built only for the submissions the funder selected; a close takes none.
  z.discriminatedUnion("kind", [
    z.object({ action: z.literal("prepare"), kind: z.literal("release"), submissionIds }),
    z.object({ action: z.literal("prepare"), kind: z.literal("close") }),
  ]),
  z.object({ action: z.literal("submit"), kind: z.enum(["release", "close"]), opId: z.string().min(1), signedXdr: z.string().min(1) }),
]);

/**
 * Final approval, release and close, for the campaign's owner with the funder
 * role or, without it, for the owner of a funded campaign (`canManageCampaign`):
 * a funder whose access was revoked can still pay out and close what it
 * already funded, and nothing else. Every service below checks ownership
 * again. Create, deploy and fund keep the role gate.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return jsonRoute(schema, async (input) => {
    const user = await requireUser(id);
    const c = await getCampaignById(id);
    if (!c) throw AppError.notFound("campaign");
    if (!canManageCampaign(c, user)) {
      throw AppError.forbidden(c.funderPubkey === user.pubkey ? "requires funder role" : "not the funder of this campaign");
    }
    const escrow = getEscrow();
    switch (input.action) {
      case "approve":
        return approveForPayout(id, input.submissionIds, user, escrow);
      case "prepare":
        return input.kind === "close" ? { ops: [await prepareClose(id, user, escrow)] } : { ops: await prepareReleaseOp(id, input.submissionIds, user, escrow) };
      case "submit": {
        const args = { campaignId: id, opId: input.opId, signedXdr: input.signedXdr };
        return input.kind === "close" ? confirmClose(args, user, escrow) : confirmReleaseOp(args, user, escrow);
      }
    }
  })(req);
}
