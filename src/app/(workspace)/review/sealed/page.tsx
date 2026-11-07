import Link from "next/link";
import { notFound } from "next/navigation";
import { SealedReviewCreate } from "@/components/sealed-review-create";
import { SignedOut } from "@/components/signed-out";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/page-header";
import { sealedDualReviewEnabled } from "@/config/env";
import { currentUser } from "@/lib/current-user";
import { sealedReviewCandidates, sealedReviewList } from "@/services/sealed-review";

export const dynamic = "force-dynamic";

export default async function SealedReviewPage() {
  if (!sealedDualReviewEnabled()) notFound();
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const [{ assigned, managed }, candidates] = await Promise.all([sealedReviewList(user), sealedReviewCandidates(user)]);
  const rounds = new Map<string, { id: string; shortId: string; campaign: string; status: string }>();
  for (const item of [...managed, ...assigned]) rounds.set(item.round.id, { id: item.round.id, shortId: item.submission.shortId, campaign: item.campaign.title, status: item.round.status });

  return (
    <div className="space-y-8 pb-24">
      <PageHeader eyebrow="Experimental" title="Sealed dual review" description="Two assigned reviewers seal rubric v2 assessments in a zero-escrow Sub Rosa ReceiptOnly round, reveal together, then an authorized reviewer records the final Proofwork decision." />
      <SealedReviewCreate candidates={candidates} />
      <section>
        <h2 className="text-base font-semibold">Your sealed reviews</h2>
        {rounds.size === 0 ? <Card className="mt-3 p-6 text-sm text-muted">No sealed review is assigned or managed by this wallet.</Card> : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {[...rounds.values()].map((round) => (
              <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div><p className="text-sm font-medium">{round.campaign}</p><p className="font-mono text-xs text-muted">{`${round.shortId} · ${round.status}`}</p></div>
                <Link href={`/review/sealed/${encodeURIComponent(round.id)}`} className="text-sm font-medium text-accent hover:underline">Open →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
