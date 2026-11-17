import Link from "next/link";
import { ReviewQueue } from "@/components/review-queue";
import { SignedOut } from "@/components/signed-out";
import { buttonClasses } from "@/components/ui/button";
import { ax, Label } from "@/components/workspace/kit";
import { PageHeader } from "@/components/workspace/page-header";
import { requestNow } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { reviewLogCampaigns, reviewQueue } from "@/services/review";
import { sealedDualReviewEnabled } from "@/config/env";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await currentUser();
  if (!user) return <SignedOut />;

  // Campaign-scoped reviewers have no global role but may still download their campaigns' logs.
  const logs = await reviewLogCampaigns(user);
  const reviewer = user.roles.has("reviewer");
  const queue = reviewer ? await reviewQueue() : [];
  const now = requestNow();

  return (
    <div className="space-y-10 pb-24">
      <PageHeader
        eyebrow="Review"
        title="Review queue"
        description="Score every signal, pick the primary reason, write one line the contributor could act on. Each decision is committed on-chain the moment you record it."
      />

      {sealedDualReviewEnabled() ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-white/[0.07] bg-[#0d0d0d] px-5 py-4">
          <div>
            <p className="text-[15px] font-semibold">Experimental sealed dual review</p>
            <p className="mt-1 text-[13px] text-white/50">Two independent rubric assessments, hidden until a shared timed reveal.</p>
          </div>
          <Link href="/review/sealed" className={buttonClasses("secondary", "sm")}>
            Open sealed reviews
          </Link>
        </div>
      ) : null}

      {reviewer ? (
        <ReviewQueue
          now={now}
          items={queue.map((q) => ({
            submissionId: q.submissionId,
            shortId: q.shortId,
            workUrl: q.workUrl,
            submittedAt: q.submittedAt.toISOString(),
            status: q.status,
            campaign: { ...q.campaign, deadlineAt: q.campaign.deadlineAt.toISOString() },
            priorDecision: q.priorDecision ? { outcome: q.priorDecision.outcome, reasonCode: q.priorDecision.reasonCode, note: q.priorDecision.note } : null,
            sharedFundingCount: q.sharedFundingCount,
          }))}
        />
      ) : (
        <div className="max-w-[620px] rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-7 md:p-9">
          <p className="font-display text-[clamp(2rem,3.6vw,2.75rem)] leading-[0.92]" style={{ fontVariationSettings: ax(85, 840) }}>
            Your wallet has no reviewer role.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-white/60">
            Ask the operator to grant one.{logs.length > 0 ? " You can still download the review logs of the campaigns below." : null}
          </p>
          <Link href="/explore" className={`${buttonClasses("secondary", "sm")} mt-6`}>
            Browse open campaigns <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}

      {logs.length > 0 ? (
        <section aria-labelledby="review-logs" className="space-y-5">
          <div>
            <h2 id="review-logs" className="font-display text-[clamp(1.75rem,3vw,2.4rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>
              Review logs
            </h2>
            <p className="mt-2 text-[14px] text-white/50">Every decision per campaign, re-reviews included, with its on-chain reference.</p>
          </div>
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-[24px] border border-white/[0.07] bg-[#0d0d0d]">
            {logs.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex min-w-0 items-center gap-5">
                  <span aria-hidden="true" className="w-12 shrink-0 text-right font-display text-[34px] leading-none text-white/80" style={{ fontVariationSettings: ax(62, 900) }}>
                    {c.decisions}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">{c.title}</p>
                    <Label className="mt-1 tracking-[0.14em]">{`${c.decisions} ${c.decisions === 1 ? "decision" : "decisions"}`}</Label>
                  </div>
                </div>
                <a href={`/api/campaigns/${encodeURIComponent(c.id)}/review-log`} className={buttonClasses("secondary", "sm")}>
                  Download review log
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
