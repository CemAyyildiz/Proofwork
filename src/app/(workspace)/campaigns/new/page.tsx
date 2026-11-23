import Link from "next/link";
import { redirect } from "next/navigation";
import { CampaignForm } from "@/components/campaign-form";
import { PageHeader } from "@/components/workspace/page-header";
import { funderLimits, pinnedDisputeResolver, sealedDualReviewEnabled } from "@/config/env";
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
    <div className="space-y-10">
      <div>
        <Link href="/campaigns" className="inline-flex min-h-9 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-text">
          <span aria-hidden="true">←</span> Campaigns
        </Link>
        <div className="mt-4">
          <PageHeader
            eyebrow="Fund a bounty"
            title="New campaign"
            description={
              <>
                You will sign two transactions after saving: one to deploy the escrow, one to move the budget into it. Rewards are
                paid net of the 0.3% Trustless Work protocol fee, and the same fee is taken from the remainder that returns to you
                when the campaign is closed.
              </>
            }
          />
        </div>
      </div>
      <CampaignForm
        pinnedDisputeResolver={pinnedDisputeResolver()}
        now={now}
        limits={limits}
        sealedReviewAvailable={sealedDualReviewEnabled()}
      />
    </div>
  );
}
