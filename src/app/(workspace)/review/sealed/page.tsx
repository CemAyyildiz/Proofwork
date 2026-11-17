import Link from "next/link";
import { notFound } from "next/navigation";
import { SealedReviewCreate } from "@/components/sealed-review-create";
import { SignedOut } from "@/components/signed-out";
import { ax } from "@/components/workspace/kit";
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
    <div className="space-y-10 pb-24">
      <PageHeader eyebrow="Experimental" title="Sealed dual review" description="Two assigned reviewers seal rubric v2 assessments in a zero-escrow Sub Rosa ReceiptOnly round, reveal together, then an authorized reviewer records the final Proofwork decision." />
      <SealedReviewCreate candidates={candidates} />
      <section>
        <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>
          Your sealed reviews
        </h2>
        {rounds.size === 0 ? (
          <p className="mt-4 rounded-[22px] border border-dashed border-white/12 px-5 py-8 text-sm text-white/45">No sealed review is assigned or managed by this wallet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-[24px] border border-white/[0.07] bg-[#0d0d0d]">
            {[...rounds.values()].map((round) => (
              <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{round.campaign}</p>
                  <p className="mt-1 font-mono text-[11.5px] uppercase tracking-[0.12em] text-white/45">{`${round.shortId} · ${round.status}`}</p>
                </div>
                <Link href={`/review/sealed/${encodeURIComponent(round.id)}`} className="inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 text-sm font-semibold transition-colors hover:border-white/40">
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
