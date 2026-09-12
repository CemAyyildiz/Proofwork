"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const field = "w-full rounded border border-neutral-300 px-3 py-2 text-sm";

export function CampaignForm({ defaultDisputeResolver, now }: { defaultDisputeResolver: string; now: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  // `now` comes from the server render so this stays a pure function of props and state.
  const closesAt = new Date(now + days * 86_400_000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const body = {
      title: f.get("title"),
      brief: f.get("brief"),
      rewardAmount: f.get("rewardAmount"),
      budget: f.get("budget"),
      deadlineAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      disputeResolverPubkey: f.get("disputeResolverPubkey"),
    };
    try {
      const res = await fetch("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { slug?: string; message?: string; details?: { issues?: Array<{ path: unknown[]; message: string }> } };
      if (!res.ok) {
        const issue = json.details?.issues?.[0];
        throw new Error(issue ? `${issue.path.join(".")}: ${issue.message}` : (json.message ?? "failed"));
      }
      router.push(`/campaigns/${json.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium">Title</span>
        <input name="title" required minLength={3} maxLength={100} className={field} />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Brief</span>
        <textarea name="brief" required minLength={20} maxLength={4000} rows={6} className={field}
          placeholder="What should contributors do? What must the post include? Be specific: the rubric's 'follows the brief' signal is scored against this text." />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="font-medium">Reward per approved submission (USDC)</span>
          <input name="rewardAmount" required inputMode="decimal" placeholder="5" className={field} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Total budget (USDC)</span>
          <input name="budget" required inputMode="decimal" placeholder="100" className={field} />
        </label>
      </div>
      <fieldset className="text-sm">
        <legend className="font-medium">Runs for</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {[3, 7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded border px-3 py-1.5 ${days === d ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-50"}`}
            >
              {d} days
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Closes {closesAt} UTC. Unpaid budget returns to you after that.
        </p>
      </fieldset>
      <label className="block text-sm">
        <span className="font-medium">Dispute resolver public key</span>
        <input name="disputeResolverPubkey" required defaultValue={defaultDisputeResolver} pattern="G[A-Z2-7]{55}" className={field} />
        <span className="text-xs text-neutral-500">A neutral key (the chapter lead). It can only return the remainder to you; it cannot pay anyone else.</span>
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save campaign"}
      </button>
    </form>
  );
}
