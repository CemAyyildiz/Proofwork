import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessRequestForm } from "@/components/access-request-form";
import { SignedOut } from "@/components/signed-out";
import { Pill } from "@/components/ui/pill";
import { db } from "@/db/client";
import type { Campaign, FunderRequest } from "@/db/schema";
import { currentUser } from "@/lib/current-user";
import { formatDate, formatUsdc } from "@/lib/format";
import { canManageCampaign, latestFunderRequest } from "@/services/access";
import { listCampaignsForFunder } from "@/services/campaign";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const owned = await listCampaignsForFunder(user.pubkey);

  if (user.roles.has("funder")) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <Link href="/campaigns/new" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">New campaign</Link>
        </div>
        {owned.length === 0 ? <p className="text-neutral-600">No campaigns yet.</p> : <CampaignList rows={owned} />}
      </div>
    );
  }

  // Without the funder role a wallet still reaches the campaigns it funded, so it can pay out and close them.
  const kept = owned.filter((c) => canManageCampaign(c, user));
  // A reviewer-only wallet belongs in the queue.
  if (kept.length === 0 && user.roles.has("reviewer")) redirect("/review");
  const request = await latestFunderRequest(user.pubkey, db);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <FunderAccess request={request} />
      {kept.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-medium">Campaigns you funded</h2>
          <p className="text-sm text-text-2">
            This wallet no longer has funder access. You can still approve payouts, release them and close these campaigns.
          </p>
          <CampaignList rows={kept} />
        </section>
      ) : null}
    </div>
  );
}

function CampaignList({ rows }: { rows: Campaign[] }) {
  return (
    <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
      {rows.map((c) => (
        <li key={c.id} className="flex items-center justify-between px-4 py-3">
          <div>
            <Link href={`/campaigns/${c.slug}`} className="font-medium hover:underline">{c.title}</Link>
            <p className="text-xs text-neutral-500">
              {formatUsdc(c.budget)} budget · {formatUsdc(c.rewardAmount)} per approved submission · closes {formatDate(c.deadlineAt)}
            </p>
          </div>
          <span className="text-xs text-neutral-500">
            {c.closedAt ? "closed" : c.fundedAt ? "funded" : c.escrowContractId ? "deployed" : "draft"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a wallet without the funder role sees: its pending request, or the
 * form. An approved request without the role means access was revoked later.
 */
function FunderAccess({ request }: { request: FunderRequest | null }) {
  if (request?.status === "pending") {
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
      {request?.status === "rejected" ? (
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
      ) : request?.status === "approved" ? (
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
