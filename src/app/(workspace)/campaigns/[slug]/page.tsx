import { notFound } from "next/navigation";
import { EscrowActions } from "@/components/escrow-actions";
import { CopyLink } from "@/components/copy-link";
import { PayoutActions } from "@/components/payout-actions";
import { publicEnv } from "@/config/public-env";
import { currentUser } from "@/lib/current-user";
import { formatDate, formatUsdc } from "@/lib/format";
import { getCampaignBySlug } from "@/services/campaign";
import { listOps } from "@/services/escrow-ops";
import { submissionsForFunder } from "@/services/payout";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCampaignBySlug(slug);
  if (!c) notFound();
  const user = await currentUser(c.id);
  const isFunder = user?.pubkey === c.funderPubkey && user.roles.has("funder");
  if (!isFunder) notFound();
  const ops = await listOps(c.id);
  const subs = await submissionsForFunder(c.id);
  const rows = subs.map((r) => ({
    submissionId: r.submission.id,
    shortId: r.submission.shortId,
    workUrl: r.submission.workUrl,
    contributor: r.submission.contributorPubkey,
    status: r.submission.status,
    outcome: r.latest?.outcome ?? null,
    reasonCode: r.latest?.reasonCode ?? null,
    note: r.latest?.note ?? null,
    decisionId: r.latest?.id ?? null,
    payoutStatus: r.payout?.status ?? null,
    releaseTxHash: r.payout?.releaseTxHash ?? null,
  }));
  const counts = { toRelease: subs.filter((r) => r.payout?.status === "approved").length };

  const stage = c.closedAt ? "closed" : c.fundedAt ? "funded" : c.escrowContractId ? "deployed" : "draft";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-neutral-500">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs uppercase tracking-wide">{stage}</span>{" "}
          {formatUsdc(c.budget)} budget · {formatUsdc(c.rewardAmount)} per approved submission · closes {formatDate(c.deadlineAt)}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Escrow</h2>
        {c.escrowContractId ? (
          <p className="text-sm">
            Contract{" "}
            <a className="underline" href={publicEnv.explorerAccountUrl(c.escrowContractId)} target="_blank" rel="noreferrer">
              <code className="text-xs">{c.escrowContractId.slice(0, 10)}…{c.escrowContractId.slice(-6)}</code>
            </a>
          </p>
        ) : (
          <p className="text-sm text-neutral-600">Not deployed yet.</p>
        )}
        <EscrowActions campaignId={c.id} funderPubkey={c.funderPubkey} stage={stage} />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Contributor link</h2>
        <CopyLink path={`/c/${c.slug}`} />
        <p className="text-xs text-neutral-500">Share after funding. Submissions open only while the escrow holds the budget.</p>
      </section>

      {c.fundedAt ? (
        <section className="space-y-2">
          <h2 className="font-medium">Submissions and payouts</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-600">No submissions yet.</p>
          ) : (
            <PayoutActions campaignId={c.id} funderPubkey={c.funderPubkey} rows={rows} counts={counts} closed={c.closedAt !== null} />
          )}
          {rows.some((r) => r.decisionId) ? (
            <p className="text-sm">
              <a className="underline" href={`/api/campaigns/${encodeURIComponent(c.id)}/review-log`} download>
                Download review log
              </a>
            </p>
          ) : null}
          {c.remainderTxHash ? (
            <p className="text-sm text-green-700">
              Remainder returned:{" "}
              <a className="underline" href={publicEnv.explorerTxUrl(c.remainderTxHash)} target="_blank" rel="noreferrer">
                {c.remainderTxHash.slice(0, 12)}…
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-medium">Brief</h2>
        <p className="whitespace-pre-wrap text-sm">{c.brief}</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">On-chain operations</h2>
        {ops.length === 0 ? (
          <p className="text-sm text-neutral-600">None yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {ops.map((o) => (
                <tr key={o.id} className="border-t border-neutral-200">
                  <td className="py-1 pr-3">{o.kind}</td>
                  <td className="py-1 pr-3">{o.status}</td>
                  <td className="py-1">
                    {o.txHash ? (
                      <a className="text-xs underline" href={publicEnv.explorerTxUrl(o.txHash)} target="_blank" rel="noreferrer">
                        {o.txHash.slice(0, 12)}…
                      </a>
                    ) : o.error ? (
                      <span className="text-xs text-red-600">{o.error.slice(0, 120)}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
