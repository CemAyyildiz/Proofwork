import { redirect } from "next/navigation";
import { CampaignForm } from "@/components/campaign-form";
import { env, funderLimits } from "@/config/env";
import { requestNow } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { funderUsage } from "@/services/campaign";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const user = await currentUser();
  if (!user?.roles.has("funder")) redirect("/campaigns");
  const now = requestNow();
  // Shown before the form is filled in; the service checks the same numbers again on save and on deploy.
  const limits = { ...funderLimits(), ...(await funderUsage(user.pubkey)) };
  return (
    <div className="space-y-6">
      <h1 className="text-[clamp(28px,3.2vw,40px)] font-semibold leading-[1.05] tracking-[-0.04em]">New campaign</h1>
      <p className="max-w-[760px] text-sm leading-normal text-text-2">
        You will sign two transactions after saving: one to deploy the escrow, one to move the budget into it. Rewards are
        paid net of the 0.3% Trustless Work protocol fee, and the same fee is taken from the remainder that returns to you
        when the campaign is closed.
      </p>
      <CampaignForm defaultDisputeResolver={env.DEFAULT_DISPUTE_RESOLVER_PUBKEY ?? ""} now={now} limits={limits} />
    </div>
  );
}
