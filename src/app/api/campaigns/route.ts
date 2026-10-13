import { funderLimits } from "@/config/env";
import { getEscrow, getPlatformKeys } from "@/escrow";
import { requireUserRole } from "@/lib/current-user";
import { jsonRoute } from "@/lib/http";
import { enforce, limiters } from "@/lib/ratelimit";
import { createCampaign, createCampaignSchema, listCampaignsForFunder } from "@/services/campaign";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = jsonRoute(createCampaignSchema, async (input) => {
  const user = await requireUserRole("funder");
  await enforce(limiters.campaign, `campaign:${user.pubkey}`);
  getEscrow(); // fail here on misconfiguration, not at first signing
  const keys = getPlatformKeys();
  const c = await createCampaign(input, { pubkey: user.pubkey, platformAdmin: keys.admin, platformOps: keys.ops }, funderLimits());
  return { id: c.id, slug: c.slug };
});

export const GET = jsonRoute(z.object({}), async () => {
  const user = await requireUserRole("funder");
  return { campaigns: await listCampaignsForFunder(user.pubkey) };
});
