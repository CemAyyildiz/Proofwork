"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { ax, figure, figureAxes, stroopsOf } from "@/components/workspace/kit";
import { LimitMeter } from "@/components/workspace/limit-meter";
import { fromStroops, toStroops } from "@/escrow/amount";
import { formatDateShort, formatUsdc } from "@/lib/format";

const field =
  "mt-2 w-full rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3.5 text-[15px] text-text outline-none transition-colors duration-200 placeholder:text-white/25 hover:border-white/20 focus-visible:border-accent focus-visible:outline-none";
const labelText = "font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60";

/** The per-funder caps and what this wallet has open, as the server read them for this page. */
export interface FunderLimitsView {
  maxOpenCampaigns: number;
  openCampaigns: number;
  /** USDC decimal strings. */
  maxOpenBudget: string;
  openBudget: string;
}

/** What the preview card shows while the form is filled in. Read from the inputs; the form still submits its own fields. */
interface Draft {
  title: string;
  reward: string;
  budget: string;
}

const DAYS = [3, 7, 14, 30] as const;

export function CampaignForm({
  defaultDisputeResolver,
  now,
  limits,
  sealedReviewAvailable = false,
}: {
  defaultDisputeResolver: string;
  now: number;
  limits: FunderLimitsView;
  sealedReviewAvailable?: boolean;
}) {
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
  const [draft, setDraft] = useState<Draft>({ title: "", reward: "", budget: "" });
  // `now` comes from the server render so this stays a pure function of props and state.
  const closesAt = formatDateShort(new Date(now + days * 86_400_000));

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
      founderSealedReview: f.get("founderSealedReview") === "on",
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

  function onInput(e: React.FormEvent<HTMLFormElement>) {
    const f = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = f.get(k);
      return typeof v === "string" ? v : "";
    };
    setDraft({ title: text("title"), reward: text("rewardAmount"), budget: text("budget") });
  }

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
      <form onSubmit={onSubmit} onInput={onInput} className="min-w-0 space-y-6 rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-5 sm:p-8">
        <Limits limits={limits} budgetLeft={budgetLeft} blocked={blocked} />

        <label className="block">
          <span className={labelText}>Title</span>
          <input
            name="title"
            required
            minLength={3}
            maxLength={100}
            placeholder="What contributors will see first"
            className={cx(field, "font-display text-[clamp(1.4rem,2.4vw,1.9rem)] leading-tight placeholder:font-sans placeholder:text-[17px]")}
            style={{ fontVariationSettings: ax(88, 780) }}
          />
        </label>
        <label className="block">
          <span className={labelText}>Brief</span>
          <textarea
            name="brief"
            required
            minLength={20}
            maxLength={4000}
            rows={6}
            className={cx(field, "leading-relaxed")}
            placeholder="What should contributors do? What must the post include? Be specific: the rubric's 'follows the brief' signal is scored against this text."
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountField name="rewardAmount" label="Reward per approved submission (USDC)" placeholder="5" />
          <AmountField name="budget" label="Total budget (USDC)" placeholder="100" />
        </div>
        <fieldset>
          <legend className={labelText}>Runs for</legend>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => setDays(d)}
                className={cx(
                  "inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold transition-colors duration-150 sm:px-5",
                  days === d ? "border-paper bg-paper text-paper-ink" : "border-white/12 text-white/65 hover:border-white/30 hover:text-text",
                )}
              >
                {d} days
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-white/60">
            Closes {closesAt}. After that you close the campaign here, and the dispute resolver returns what is left of the budget, less
            the 0.3% protocol fee.
          </p>
        </fieldset>
        {sealedReviewAvailable ? (
          <label className="flex cursor-pointer gap-3.5 rounded-[20px] border border-white/10 bg-white/[0.02] p-4 text-sm transition-colors has-[:checked]:border-accent/50">
            <input name="founderSealedReview" type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" />
            <span>
              <span className="block font-semibold">Founder-sealed review</span>
              <span className="mt-1 block text-[13px] leading-relaxed text-white/60">
                Reviews are fixed to your wallet and Proofwork&apos;s configured founder wallet. Only the founder can record the final decision and sign reward release.
              </span>
            </span>
          </label>
        ) : null}
        <label className="block">
          <span className={labelText}>Dispute resolver public key</span>
          <input name="disputeResolverPubkey" required defaultValue={defaultDisputeResolver} pattern="G[A-Z2-7]{55}" className={cx(field, "font-mono text-[13px]")} />
          <span className="mt-2 block text-[13px] leading-relaxed text-white/60">
            Proofwork&apos;s resolver key, kept in a wallet and never on the server. After you close the campaign, it signs the return of what is left in
            the escrow, and that transaction can only pay your wallet.{" "}
            <a href="/custody" target="_blank" rel="noreferrer" className="text-white/75 underline decoration-white/30 underline-offset-4 hover:text-text">
              Custody and fees ↗
            </a>
          </span>
        </label>
        {error ? (
          <p role="alert" className="rounded-2xl border border-fail-line bg-fail-soft px-4 py-3 text-sm text-fail">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4 border-t border-white/[0.07] pt-6">
          <Button type="submit" disabled={blocked !== null} busy={busy} busyLabel="Saving…">
            Save campaign
          </Button>
          <p className="text-[13px] text-white/60">Saving signs nothing. Deploy and fund come next, on the campaign page.</p>
        </div>
      </form>

      <div className="xl:sticky xl:top-10">
        <Preview draft={draft} days={days} closesAt={closesAt} />
      </div>
    </div>
  );
}

function AmountField({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return (
    <label className="flex h-full flex-col justify-between">
      <span className={labelText}>{label}</span>
      <span className="relative mt-2 block">
        <input
          name={name}
          required
          inputMode="decimal"
          placeholder={placeholder}
          className="w-full rounded-[18px] border border-white/10 bg-white/[0.03] py-2.5 pl-4 pr-20 font-display text-[44px] leading-none text-text outline-none transition-colors duration-200 placeholder:text-white/15 hover:border-white/20 focus-visible:border-accent focus-visible:outline-none"
          style={{ fontVariationSettings: ax(65, 900) }}
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[12px] text-white/55">
          USDC
        </span>
      </span>
    </label>
  );
}

/** The per-funder caps as two meter rows that turn red at the cap, with the same words the server uses. */
function Limits({ limits, budgetLeft, blocked }: { limits: FunderLimitsView; budgetLeft: bigint; blocked: string | null }) {
  return (
    <section aria-label="Your limits" className="rounded-[22px] bg-white/[0.03] p-4 sm:p-5">
      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Your limits</h2>
      <dl className="mt-4 grid gap-5 sm:grid-cols-2 sm:gap-8">
        <LimitMeter
          label="Open campaigns"
          value={`${limits.openCampaigns} of ${limits.maxOpenCampaigns} in use`}
          used={limits.openCampaigns}
          max={limits.maxOpenCampaigns}
          over={limits.openCampaigns >= limits.maxOpenCampaigns}
        />
        <LimitMeter
          label="Open budget"
          value={`${formatUsdc(limits.openBudget)} of ${formatUsdc(limits.maxOpenBudget)} in use${budgetLeft > 0n ? `, ${formatUsdc(fromStroops(budgetLeft))} left` : ""}`}
          used={limits.openBudget}
          max={limits.maxOpenBudget}
          over={budgetLeft <= 0n}
        />
      </dl>
      <p className="mt-4 text-[12.5px] leading-relaxed text-white/60">
        A campaign starts to count when its escrow is deployed and stops when it is closed. A new campaign can&apos;t be
        created while a limit is reached, or with a budget larger than what is left.
      </p>
      {blocked ? (
        <p role="alert" className="mt-3 text-sm font-medium text-fail">
          {blocked}
        </p>
      ) : null}
    </section>
  );
}

/** The bounty card contributors will see, drawn from what is typed so far: reward huge, one slot per reward the budget pays. */
function Preview({ draft, days, closesAt }: { draft: Draft; days: number; closesAt: string }) {
  // Positive decimals the preview can draw with, in stroops; validation proper is the server's.
  const rewardStroops = stroopsOf(draft.reward);
  const budgetStroops = stroopsOf(draft.budget);
  const reward = rewardStroops === null ? null : fromStroops(rewardStroops);
  const slotsBig = rewardStroops !== null && budgetStroops !== null ? budgetStroops / rewardStroops : 0n;
  const spare = rewardStroops !== null && budgetStroops !== null && slotsBig > 0n ? budgetStroops - slotsBig * rewardStroops : 0n;
  const slots = Number(slotsBig);
  const shown = Math.min(slots, 40);
  return (
    <section aria-label="Preview" className="space-y-3">
      <p className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">
        <span>Preview · bounty card</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 animate-ping rounded-full bg-accent text-accent" />
          live
        </span>
      </p>
      <div data-surface="paper" className="flex min-h-[480px] flex-col rounded-[30px] bg-paper p-7 text-paper-ink shadow-[0_40px_100px_-40px_rgba(0,0,0,0.8)]">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">Your team</span>
          <span className="rounded-full bg-black px-2.5 py-1 font-mono text-[11px] text-accent">{`${days}d left`}</span>
        </div>
        <p
          className={cx("mt-6 line-clamp-3 font-display text-[clamp(1.8rem,2.6vw,2.3rem)] leading-[0.95] [overflow-wrap:anywhere]", !draft.title && "text-black/25")}
          style={{ fontVariationSettings: ax(85, 800) }}
        >
          {draft.title || "Your campaign title"}
        </p>
        <div className="mt-auto pt-8">
          <p
            className={cx("font-display text-[clamp(5rem,9vw,7rem)] leading-[0.8] transition-colors [overflow-wrap:anywhere]", !reward && "text-black/20")}
            style={{ fontVariationSettings: figureAxes(reward ? figure(reward) : "0") }}
          >
            {reward ? figure(reward) : "0"}
          </p>
          <p className="mt-2 text-sm font-semibold">USDC for every approved post</p>
          <div className="mt-5 flex min-h-6 gap-[3px]" aria-hidden="true">
            {shown > 0
              ? Array.from({ length: shown }, (_, i) => <span key={`${slots}-${i}`} className="h-6 min-w-0 flex-1 animate-pop rounded-[3px] bg-black/12" style={{ animationDelay: `${i * 12}ms` }} />)
              : <span className="h-6 flex-1 rounded-[3px] border border-dashed border-black/20" />}
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-black/60">
            <span>{slots > 0 ? `0 of ${slots} paid${slots > shown ? ` (first ${shown} shown)` : ""}` : "Set a reward and a budget"}</span>
            <span className="whitespace-nowrap">{`Closes ${closesAt}`}</span>
          </div>
          {spare > 0n ? (
            <p className="mt-2 text-xs text-black/65">{`${figure(fromStroops(spare))} USDC of the budget is less than one reward. It goes back to your wallet with the remainder after the campaign is closed, less the 0.3% fee.`}</p>
          ) : null}
          <span aria-hidden="true" className="mt-5 flex items-center justify-between rounded-full bg-black px-5 py-3.5 text-sm font-semibold text-white">
            Do this bounty <span>→</span>
          </span>
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-white/60">Each contributor receives the reward less the 0.3% protocol fee. Contributors see this once the budget is in escrow.</p>
    </section>
  );
}
