import Link from "next/link";
import { currentUser } from "@/lib/current-user";
import { formatDate, formatUsdc } from "@/lib/format";
import { listCampaignsForFunder } from "@/services/campaign";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await currentUser();
  if (!user) return <p className="text-neutral-600">Connect your wallet to see your campaigns.</p>;
  if (!user.roles.has("funder")) return <p className="text-neutral-600">Your wallet has no funder role. Ask the operator to grant one.</p>;

  const rows = await listCampaignsForFunder(user.pubkey);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/new" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">New campaign</Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-neutral-600">No campaigns yet.</p>
      ) : (
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
      )}
    </div>
  );
}
