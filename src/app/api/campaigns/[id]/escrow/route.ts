import { z } from "zod";
import { funderLimits } from "@/config/env";
import { getEscrow, getPlatformKeys } from "@/escrow";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { abandonCampaign, confirmDeploy, confirmFund, fundSubmitted, horizonFunderAccountReader, prepareDeploy, prepareFund } from "@/services/campaign";

export const runtime = "nodejs";

/**
 * Funder-side escrow operations. `prepare` returns an unsigned XDR for the
 * wallet; `submit` takes the signed XDR back and confirms it on-chain.
 * `abandon` closes a campaign whose escrow was deployed and never funded; it
 * signs and sends nothing.
 */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), kind: z.enum(["deploy", "fund"]) }),
  z.object({ action: z.literal("submit"), kind: z.enum(["deploy", "fund"]), opId: z.string().min(1), signedXdr: z.string().min(1) }),
  z.object({ action: z.literal("abandon") }),
]);

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return jsonRoute(schema, async (input) => {
    const user = await requireUser(id);
    // Deploy and a first fund put new money in, so they need the funder role.
    // A fund already sent to the network is different: the budget may be in
    // the escrow with the campaign not yet marked funded, and its owner must
    // be able to reconcile that after losing the role. A rebuilt fund is back
    // at `intent`, so it cannot be submitted without the role either. The
    // services check ownership.
    const reconcilingFund = input.action !== "abandon" && input.kind === "fund" && (await fundSubmitted(id));
    if (!user.roles.has("funder") && !reconcilingFund) throw AppError.forbidden("requires funder role");
    if (input.action === "abandon") {
      const c = await abandonCampaign(id, user);
      return { closedAt: c.closedAt };
    }
    const keys = getPlatformKeys();
    const escrow = getEscrow();
    const actor = { pubkey: user.pubkey, platformAdmin: keys.admin, platformOps: keys.ops };
    if (input.action === "prepare") {
      // Every prepare can cost a Horizon read, so it is counted per wallet.
      await enforce(limiters.escrowPrepare, `escrow-prepare:${user.pubkey}`);
      // The caps and the wallet are checked where a transaction is built: a fund that already
      // reached the network is reconciled first and never meets the wallet check.
      const account = horizonFunderAccountReader();
      return input.kind === "deploy"
        ? prepareDeploy(id, actor, escrow, { limits: funderLimits(), account })
        : prepareFund(id, actor, escrow, account);
    }
    const args = { campaignId: id, opId: input.opId, signedXdr: input.signedXdr };
    // A deploy meets the caps a second time here, before its signed transaction is sent: one prepared
    // while the funder was under the caps is refused if other deploys have used them up since.
    return input.kind === "deploy" ? confirmDeploy(args, actor, escrow, funderLimits()) : confirmFund(args, actor, escrow);
  })(req);
}
