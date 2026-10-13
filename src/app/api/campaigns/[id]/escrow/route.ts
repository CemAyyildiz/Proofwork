import { z } from "zod";
import { funderLimits } from "@/config/env";
import { getEscrow, getPlatformKeys } from "@/escrow";
import { requireUser } from "@/lib/current-user";
import { AppError } from "@/lib/errors";
import { jsonRoute } from "@/lib/http";
import { confirmDeploy, confirmFund, fundSubmitted, horizonFunderAccountReader, prepareDeploy, prepareFund } from "@/services/campaign";

export const runtime = "nodejs";

/**
 * Funder-side escrow operations. `prepare` returns an unsigned XDR for the
 * wallet; `submit` takes the signed XDR back and confirms it on-chain.
 */
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), kind: z.enum(["deploy", "fund"]) }),
  z.object({ action: z.literal("submit"), kind: z.enum(["deploy", "fund"]), opId: z.string().min(1), signedXdr: z.string().min(1) }),
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
    if (!user.roles.has("funder") && !(input.kind === "fund" && (await fundSubmitted(id)))) {
      throw AppError.forbidden("requires funder role");
    }
    const keys = getPlatformKeys();
    const escrow = getEscrow();
    const actor = { pubkey: user.pubkey, platformAdmin: keys.admin, platformOps: keys.ops };
    if (input.action === "prepare") {
      // Caps and the wallet's readiness are checked where a transaction is built, never on submit:
      // a fund that already reached the network is reconciled before the wallet is read.
      const account = horizonFunderAccountReader();
      return input.kind === "deploy"
        ? prepareDeploy(id, actor, escrow, { limits: funderLimits(), account })
        : prepareFund(id, actor, escrow, account);
    }
    const args = { campaignId: id, opId: input.opId, signedXdr: input.signedXdr };
    return input.kind === "deploy" ? confirmDeploy(args, actor, escrow) : confirmFund(args, actor, escrow);
  })(req);
}
