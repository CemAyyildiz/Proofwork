"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { fromStroops, toStroops } from "@/escrow/amount";
import { formatUsdc } from "@/lib/format";

const field =
  "mt-2 w-full rounded-[14px] border border-line-strong bg-sunken px-3.5 py-3 text-sm text-text placeholder:text-faint focus-visible:border-accent";
const labelText = "text-[13px] font-medium text-text-2";

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
  // A limit is reached: the server refuses a new campaign, so say it before the form is filled in.
  const blocked =
    limits.openCampaigns >= limits.maxOpenCampaigns
      ? "You have reached the open-campaign limit, so a new campaign can't be created. Close a campaign first."
      : budgetLeft <= 0n
        ? "You have reached the open-budget limit, so a new campaign can't be created. Close a campaign first."
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
            {budgetLeft > 0n ? `, ${formatUsdc(fromStroops(budgetLeft))} left` : ""}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-muted">
          A campaign starts to count when its escrow is deployed and stops when it is closed. A new campaign can&apos;t be
          created while a limit is reached, or with a budget larger than what is left.
        </p>
        {blocked ? (
          <p role="alert" className="mt-2 text-fail">
            {blocked}
          </p>
        ) : null}
      </section>
      <label className="block text-sm">
        <span className={labelText}>Title</span>
        <input name="title" required minLength={3} maxLength={100} className={field} />
      </label>
      <label className="block text-sm">
        <span className={labelText}>Brief</span>
        <textarea name="brief" required minLength={20} maxLength={4000} rows={6} className={field}
          placeholder="What should contributors do? What must the post include? Be specific: the rubric's 'follows the brief' signal is scored against this text." />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className={labelText}>Reward per approved submission (USDC)</span>
          <input name="rewardAmount" required inputMode="decimal" placeholder="5" className={field} />
        </label>
        <label className="block text-sm">
          <span className={labelText}>Total budget (USDC)</span>
          <input name="budget" required inputMode="decimal" placeholder="100" className={field} />
        </label>
      </div>
      <fieldset className="text-sm">
        <legend className={labelText}>Runs for</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[3, 7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cx(
                "inline-flex h-11 items-center rounded-[10px] border px-3.5 text-[13.5px] font-medium transition-colors duration-150 md:h-9",
                days === d ? "border-accent-line bg-accent-soft text-text" : "border-line-strong text-text-2 hover:bg-raised hover:text-text",
              )}
            >
              {d} days
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Closes {closesAt} UTC. After that you close the campaign here, and the dispute resolver returns what is left of the budget, less
          the 0.3% protocol fee.
        </p>
      </fieldset>
      <label className="block text-sm">
        <span className={labelText}>Dispute resolver public key</span>
        <input name="disputeResolverPubkey" required defaultValue={defaultDisputeResolver} pattern="G[A-Z2-7]{55}" className={field} />
        <span className="mt-1.5 block text-xs text-muted">
          A key that is neither yours nor Proofwork&apos;s (the chapter lead). After you close the campaign, this key signs the return of what is left in
          the escrow.
        </span>
      </label>
      {error ? <p className="text-sm text-fail">{error}</p> : null}
      <Button type="submit" disabled={blocked !== null} busy={busy} busyLabel="Saving…">
        Save campaign
      </Button>
    </form>
  );
}
