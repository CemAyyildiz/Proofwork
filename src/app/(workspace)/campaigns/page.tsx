import Link from "next/link";
import { AccessRequestForm } from "@/components/access-request-form";
import { SignedOut } from "@/components/signed-out";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill } from "@/components/ui/pill";
import { CampaignList, type CampaignListItem } from "@/components/workspace/campaign-list";
import { PageHeader } from "@/components/workspace/page-header";
import { publicEnv } from "@/config/public-env";
import { db } from "@/db/client";
import type { Campaign, FunderRequest } from "@/db/schema";
import { NO_SUBMISSIONS } from "@/domain/campaign-status";
import { currentUser } from "@/lib/current-user";
import { formatDate, shortKey } from "@/lib/format";
import { canManageCampaign, funderAccessState, type FunderAccessState } from "@/services/access";
import { listCampaignsForFunder, submissionCountsFor } from "@/services/campaign";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const owned = await listCampaignsForFunder(user.pubkey);
  const now = new Date();
  const wallet = <WalletLine pubkey={user.pubkey} />;

  if (user.roles.has("funder")) {
    const items = await withCounts(owned);
    return (
      <div className="space-y-10">
        <PageHeader
          title="Campaigns"
          description={wallet}
          action={
            <Link href="/campaigns/new" className={buttonClasses("primary", "md")}>
              New campaign
            </Link>
          }
        />
        {items.length === 0 ? (
          <Card className="p-8 text-center sm:p-10">
            <p className="text-[15px] leading-normal text-text-2">
              No campaigns funded by{" "}
              <span className="font-mono font-medium text-text" title={user.pubkey}>
                {shortKey(user.pubkey)}
              </span>
              . Campaigns are listed under the wallet that funded them.
            </p>
            <Link href="/campaigns/new" className={`${buttonClasses("secondary", "sm")} mt-5`}>
              New campaign
            </Link>
          </Card>
        ) : (
          <CampaignList items={items} now={now} />
        )}
      </div>
    );
  }

  // Without the funder role a wallet still reaches the campaigns it funded, so it can pay out and close them.
  const kept = await withCounts(owned.filter((c) => canManageCampaign(c, user)));
  const access = await funderAccessState(user.pubkey, db);

  return (
    <div className="space-y-10">
      <PageHeader title="Campaigns" description={wallet} />
      {user.roles.has("reviewer") ? (
        <p className="text-sm text-text-2">
          Here to review?{" "}
          <Link href="/review" className="font-medium text-accent hover:underline">
            Open the review queue →
          </Link>
        </p>
      ) : null}
      <FunderAccess state={access.state} request={access.request} />
      {kept.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Campaigns you funded</h2>
          <p className="max-w-[640px] text-sm text-text-2">
            This wallet no longer has funder access. You can still approve payouts, release them and close these campaigns.
          </p>
          <CampaignList items={kept} now={now} />
        </section>
      ) : null}
    </div>
  );
}

/** The connected wallet, so a funder can tell which wallet the list belongs to. */
function WalletLine({ pubkey }: { pubkey: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>Signed in with</span>
      <HashChip value={pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(pubkey)} />
    </span>
  );
}

async function withCounts(list: Campaign[]): Promise<CampaignListItem[]> {
  const counts = await submissionCountsFor(list.map((c) => c.id));
  return list.map((campaign) => ({ campaign, counts: counts.get(campaign.id) ?? NO_SUBMISSIONS }));
}

/** What a wallet without the funder role sees: its pending request, or the form under what happened last. */
function FunderAccess({ state, request }: { state: FunderAccessState; request: FunderRequest | null }) {
  if (state === "pending" && request) {
    return (
      <section className="max-w-[560px] rounded-[20px] border border-line-strong bg-sunken p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Funder access requested</h2>
          <Pill tone="wait">Pending</Pill>
        </div>
        <p className="mt-3 text-sm leading-normal text-text-2">
          Sent {formatDate(request.createdAt)} for <span className="font-medium text-text">{request.team}</span>. The operator
          reads every request and decides by hand. Come back to this page for the answer: once approved, you can create a
          campaign here without signing in again.
        </p>
      </section>
    );
  }
  return (
    <section className="max-w-[560px] rounded-[20px] border border-line-strong bg-sunken p-[22px]">
      {state === "rejected" && request ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Request not approved</h2>
            <Pill tone="fail">Not approved</Pill>
          </div>
          <p className="mt-3 text-sm leading-normal text-text-2">
            Your request from {formatDate(request.createdAt)} for <span className="font-medium text-text">{request.team}</span>{" "}
            was not approved. You can send a new one.
          </p>
        </>
      ) : state === "removed" ? (
        <>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Funder access removed</h2>
          <p className="mt-3 text-sm leading-normal text-text-2">
            The operator removed funder access from this wallet, so it can&apos;t create or fund a campaign. You can ask for it again.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Request funder access</h2>
          <p className="mt-3 text-sm leading-normal text-text-2">
            Creating and funding a campaign needs funder access for this wallet. Tell the operator who you are and what you
            plan to run. The answer shows on this page.
          </p>
        </>
      )}
      <AccessRequestForm />
    </section>
  );
}
