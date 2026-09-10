import { ReviewCard } from "@/components/review-card";
import { currentUser } from "@/lib/current-user";
import { reviewQueue } from "@/services/review";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await currentUser();
  if (!user) return <p className="text-neutral-600">Connect your wallet.</p>;
  if (!user.roles.has("reviewer")) return <p className="text-neutral-600">Your wallet has no reviewer role.</p>;

  const queue = await reviewQueue();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-neutral-500">
          {queue.length} waiting. Order is randomised. Score every signal, pick the primary reason, write one line the
          contributor could act on. Each decision is committed on-chain the moment you submit it.
        </p>
      </div>
      {queue.length === 0 ? (
        <p className="text-neutral-600">Nothing to review.</p>
      ) : (
        <div className="space-y-6">
          {queue.map((item) => (
            <ReviewCard key={item.submissionId} item={{ ...item, submittedAt: item.submittedAt.toISOString(), priorDecision: item.priorDecision ? { outcome: item.priorDecision.outcome, reasonCode: item.priorDecision.reasonCode, note: item.priorDecision.note } : null }} />
          ))}
        </div>
      )}
    </div>
  );
}
