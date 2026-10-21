import Link from "next/link";
import { ReviewQueue } from "@/components/review-queue";
import { SignedOut } from "@/components/signed-out";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/page-header";
import { requestNow } from "@/lib/clock";
import { currentUser } from "@/lib/current-user";
import { reviewLogCampaigns, reviewQueue } from "@/services/review";

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
        <Card className="max-w-[560px] p-6">
          <p className="text-lg font-semibold tracking-[-0.02em]">Your wallet has no reviewer role.</p>
          <p className="mt-2 text-sm leading-normal text-text-2">
            Ask the operator to grant one.{logs.length > 0 ? " You can still download the review logs of the campaigns below." : null}
          </p>
          <Link href="/explore" className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline md:min-h-0">
            Browse open campaigns <span aria-hidden="true">→</span>
          </Link>
        </Card>
      )}

      {logs.length > 0 ? (
        <section aria-labelledby="review-logs" className="space-y-3">
          <div>
            <h2 id="review-logs" className="text-base font-semibold tracking-[-0.01em]">
              Review logs
            </h2>
            <p className="mt-1 text-[13px] text-muted">Every decision per campaign, re-reviews included, with its on-chain reference.</p>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {logs.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="text-[12.5px] text-muted">{`${c.decisions} ${c.decisions === 1 ? "decision" : "decisions"}`}</p>
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
