import { z } from "zod";
import { getEscrow, getPlatformKeys } from "@/escrow";
import { requireUserRole } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";

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
    const user = await requireUserRole("funder", id);
    const keys = getPlatformKeys();
    const escrow = getEscrow();
    const actor = { pubkey: user.pubkey, platformAdmin: keys.admin, platformOps: keys.ops };
    if (input.action === "prepare") {
      return input.kind === "deploy" ? prepareDeploy(id, actor, escrow) : prepareFund(id, actor, escrow);
    }
    const args = { campaignId: id, opId: input.opId, signedXdr: input.signedXdr };
    return input.kind === "deploy" ? confirmDeploy(args, actor, escrow) : confirmFund(args, actor, escrow);
  })(req);
}
