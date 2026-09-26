import { redirect } from "next/navigation";
import { CampaignForm } from "@/components/campaign-form";
import { env } from "@/config/env";
import { requestNow } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const user = await currentUser();
  if (!user?.roles.has("funder")) redirect("/campaigns");
  const now = requestNow();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New campaign</h1>
      <p className="text-sm text-neutral-600">
        You will sign two transactions after saving: one to deploy the escrow, one to move the budget into it. Rewards are
        paid net of the 0.3% Trustless Work protocol fee.
      </p>
      <CampaignForm defaultDisputeResolver={env.DEFAULT_DISPUTE_RESOLVER_PUBKEY ?? ""} now={now} />
    </div>
  );
}
