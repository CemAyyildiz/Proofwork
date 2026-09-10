import { escrow, platformKeys } from "@/escrow";
import { requireUserRole } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { createCampaign, createCampaignSchema, listCampaignsForFunder } from "@/services/campaign";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = jsonRoute(createCampaignSchema, async (input) => {
  const user = await requireUserRole("funder");
  const c = await createCampaign(input, { pubkey: user.pubkey, platformAdmin: platformKeys.admin, platformOps: platformKeys.ops });
  void escrow; // composition root is imported so misconfiguration fails here, not at first signing
  return { id: c.id, slug: c.slug };
});

export const GET = jsonRoute(z.object({}), async () => {
  const user = await requireUserRole("funder");
  return { campaigns: await listCampaignsForFunder(user.pubkey) };
});
