import Link from "next/link";
import { AccessRequestForm } from "@/components/access-request-form";
import { SignedOut } from "@/components/signed-out";
import { buttonClasses } from "@/components/ui/button";
import { HashChip } from "@/components/ui/hash-chip";
import { CampaignList, leftOf, mostUrgent, type CampaignListItem } from "@/components/workspace/campaign-list";
import { ax, figure, figureAxes, isZero, Label, Panel } from "@/components/workspace/kit";
import { CountUp } from "@/components/workspace/motion-bits";
import { PageHeader } from "@/components/workspace/page-header";
import { publicEnv } from "@/config/public-env";
import { db } from "@/db/client";
import type { Campaign, FunderRequest } from "@/db/schema";
import { NO_SUBMISSIONS } from "@/domain/campaign-status";
import { addAmounts } from "@/escrow/amount";
import { currentUser } from "@/lib/current-user";
import { formatDateShort, shortKey } from "@/lib/format";
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
    const urgent = mostUrgent(items, now);
    return (
      <div className="space-y-12">
        <PageHeader
          title="Campaigns"
          description={wallet}
          action={
            // The page's one yellow action is the most urgent next step; New campaign takes it only when nothing waits on you.
            <Link href="/campaigns/new" className={buttonClasses(urgent ? "secondary" : "primary", "md")}>
              New campaign
            </Link>
          }
        />
        {items.length === 0 ? (
          <Panel className="px-6 py-12 text-center sm:px-10 sm:py-16">
            <p className="font-display text-[clamp(2.4rem,5vw,3.75rem)] leading-[0.9]" style={{ fontVariationSettings: ax(80, 850) }}>
              Nothing funded yet.
            </p>
            <p className="mx-auto mt-4 max-w-[460px] text-[15px] leading-normal text-white/60">
              No campaigns funded by{" "}
              <span className="font-mono font-medium text-text" title={user.pubkey}>
                {shortKey(user.pubkey)}
              </span>
              . Campaigns are listed under the wallet that funded them.
            </p>
            <Link href="/campaigns/new" className={`${buttonClasses("secondary", "md")} mt-7`}>
              New campaign
            </Link>
          </Panel>
        ) : (
          <>
            <Totals items={items} />
            <CampaignList items={items} now={now} urgent={urgent} />
          </>
        )}
      </div>
    );
  }

  // Without the funder role a wallet still reaches the campaigns it funded, so it can pay out and close them.
  const kept = await withCounts(owned.filter((c) => canManageCampaign(c, user)));
  const access = await funderAccessState(user.pubkey, db);

  return (
    <div className="space-y-12">
      <PageHeader title="Campaigns" description={wallet} />
      {user.roles.has("reviewer") ? (
        <p className="text-sm text-white/60">
          Here to review?{" "}
          <Link href="/review" className="font-semibold text-accent hover:underline">
            Open the review queue →
          </Link>
        </p>
      ) : null}
      <FunderAccess state={access.state} request={access.request} />
      {kept.length > 0 ? (
        <section className="space-y-5">
          <h2 className="font-display text-[clamp(1.8rem,3vw,2.4rem)] leading-none" style={{ fontVariationSettings: ax(85, 820) }}>
            Campaigns you funded
          </h2>
          <p className="max-w-[640px] text-sm text-white/60">
            This wallet no longer has funder access. You can still approve payouts, release them and close these campaigns.
          </p>
          <CampaignList items={kept} now={now} urgent={mostUrgent(kept, now)} />
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

/**
 * The four figures a funder opens this page for, summed over the campaigns on
 * it: what is left of the funded budgets leads, huge; what is ready to pay, in
 * review and paid sit beside it, smaller. Read from the same counts as the rows.
 */
function Totals({ items }: { items: readonly CampaignListItem[] }) {
  const live = items.filter((i) => i.campaign.fundedAt !== null && i.campaign.closedAt === null);
  const left = live.reduce((s, i) => addAmounts(s, leftOf(i.campaign.budget, i.counts.paidAmount)), "0");
  const paid = items.reduce((s, i) => addAmounts(s, i.counts.paidAmount), "0");
  const toPay = items.reduce((s, i) => s + i.counts.readyToPay + i.counts.awaitingSignature, 0);
  const review = items.reduce((s, i) => s + i.counts.inReview, 0);
  const side: Array<{ value: string; label: string }> = [
    { value: String(toPay), label: toPay === 1 ? "post ready to pay" : "posts ready to pay" },
    { value: String(review), label: "in review" },
    { value: figure(paid), label: "USDC paid out" },
  ];
  const hero = figure(left);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
      <div className="min-w-0">
        <p
          className={`font-display text-[clamp(4.5rem,11vw,8.75rem)] leading-[0.8] ${isZero(hero) ? "text-white/60" : "text-text"}`}
          style={{ fontVariationSettings: figureAxes(hero, 60, 900) }}
        >
          <CountUp value={hero} />
        </p>
        <Label as="p" className="mt-3 tracking-[0.14em]">
          USDC left in funded budgets
        </Label>
      </div>
      <dl className="grid grid-cols-3 gap-x-8 sm:gap-x-12">
        {side.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col-reverse justify-end">
            <dt className="mt-2.5 font-mono text-[11px] uppercase leading-snug tracking-[0.12em] text-white/55">{c.label}</dt>
            <dd
              className={`font-display text-[clamp(2.25rem,3.6vw,3rem)] leading-[0.85] ${isZero(c.value) ? "text-white/60" : "text-text"}`}
              style={{ fontVariationSettings: figureAxes(c.value, 64, 900) }}
            >
              <CountUp value={c.value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** What a wallet without the funder role sees: its pending request, or the form under what happened last. */
function FunderAccess({ state, request }: { state: FunderAccessState; request: FunderRequest | null }) {
  if (state === "pending" && request) {
    return (
      <Panel className="max-w-[620px] p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] leading-none" style={{ fontVariationSettings: ax(85, 820) }}>
            Funder access requested
          </h2>
          <Pending>Pending</Pending>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          Sent {formatDateShort(request.createdAt)} for <span className="font-medium text-text">{request.team}</span>. The operator
          reads every request and decides by hand. Come back to this page for the answer: once approved, you can create a
          campaign here without signing in again.
        </p>
      </Panel>
    );
  }
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="max-w-[520px] pt-2">
        {state === "rejected" && request ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Heading>Request not approved</Heading>
              <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-fail-line px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-fail">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                Not approved
              </span>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              Your request from {formatDateShort(request.createdAt)} for <span className="font-medium text-text">{request.team}</span>{" "}
              was not approved. You can send a new one.
            </p>
          </>
        ) : state === "removed" ? (
          <>
            <Heading>Funder access removed</Heading>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              The operator removed funder access from this wallet, so it can&apos;t create or fund a campaign. You can ask for it again.
            </p>
          </>
        ) : (
          <>
            <Heading>Request funder access</Heading>
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              Creating and funding a campaign needs funder access for this wallet. Tell the operator who you are and what you
              plan to run. The answer shows on this page.
            </p>
          </>
        )}
      </div>
      <Panel tone="paper" className="p-6 md:p-8">
        <AccessRequestForm />
      </Panel>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h2 className="font-display text-[clamp(2rem,3.4vw,2.75rem)] leading-[0.92]" style={{ fontVariationSettings: ax(85, 840) }}>
      {children}
    </h2>
  );
}

function Pending({ children }: { children: string }) {
  return (
    <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-white/[0.08] px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">
      <span aria-hidden="true" className="size-1.5 animate-ping rounded-full bg-current" />
      {children}
    </span>
  );
}
