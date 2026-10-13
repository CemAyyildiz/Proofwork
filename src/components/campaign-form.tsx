"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromStroops, toStroops } from "@/escrow/amount";
import { formatUsdc } from "@/lib/format";

const field = "w-full rounded border border-neutral-300 px-3 py-2 text-sm";

/** The per-funder caps and what this wallet has open, as the server read them for this page. */
export interface FunderLimitsView {
  maxOpenCampaigns: number;
  openCampaigns: number;
  /** USDC decimal strings. */
  maxOpenBudget: string;
  openBudget: string;
}

export function CampaignForm({ defaultDisputeResolver, now, limits }: { defaultDisputeResolver: string; now: number; limits: FunderLimitsView }) {
  const router = useRouter();
  const budgetLeft = toStroops(limits.maxOpenBudget) - toStroops(limits.openBudget);
  // Nothing left under a cap: the server would refuse the campaign, so say it before the form is filled in.
  const blocked =
    limits.openCampaigns >= limits.maxOpenCampaigns
      ? "You are at the open-campaign limit. Close a campaign before creating another."
      : budgetLeft <= 0n
        ? "You are at the open-budget limit. Close a campaign before creating another."
        : null;
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
      <section aria-label="Your limits" className="max-w-[560px] rounded-[14px] border border-line-strong bg-sunken p-4 text-sm">
        <h2 className="font-semibold">Your limits</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-text-2">
          <dt>Open campaigns</dt>
          <dd>
            {limits.openCampaigns} of {limits.maxOpenCampaigns} in use
          </dd>
          <dt>Open budget</dt>
          <dd>
            {formatUsdc(limits.openBudget)} of {formatUsdc(limits.maxOpenBudget)} in use
            {budgetLeft > 0n ? `, ${formatUsdc(fromStroops(budgetLeft))} left for this campaign` : ""}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-muted">
          A campaign counts from the moment its escrow is deployed until it is closed. Drafts do not count.
        </p>
        {blocked ? (
          <p role="alert" className="mt-2 text-fail">
            {blocked}
          </p>
        ) : null}
      </section>
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
      <button type="submit" disabled={busy || blocked !== null} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save campaign"}
      </button>
    </form>
  );
}
