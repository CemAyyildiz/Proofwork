import { notFound } from "next/navigation";
import { EscrowActions } from "@/components/escrow-actions";
import { publicEnv } from "@/config/public-env";
import { currentUser } from "@/lib/current-user";
import { getCampaignBySlug } from "@/services/campaign";
import { listOps } from "@/services/escrow-ops";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCampaignBySlug(slug);
  if (!c) notFound();
  const user = await currentUser(c.id);
  const isFunder = user?.pubkey === c.funderPubkey && user.roles.has("funder");
  if (!isFunder) notFound();
  const ops = await listOps(c.id);

  const stage = c.closedAt ? "closed" : c.fundedAt ? "funded" : c.escrowContractId ? "deployed" : "draft";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-neutral-500">
          {stage} · {c.budget} USDC budget · {c.rewardAmount} USDC per approved submission · deadline {c.deadlineAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Escrow</h2>
        {c.escrowContractId ? (
          <p className="text-sm">
            Contract <code className="text-xs">{c.escrowContractId}</code>
          </p>
        ) : (
          <p className="text-sm text-neutral-600">Not deployed yet.</p>
        )}
        <EscrowActions campaignId={c.id} funderPubkey={c.funderPubkey} stage={stage} />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Contributor link</h2>
        <code className="block rounded bg-neutral-100 px-3 py-2 text-xs">/c/{c.slug}</code>
        <p className="text-xs text-neutral-500">Share after funding. Submissions open only while the escrow holds the budget.</p>
      </section>

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
