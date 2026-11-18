"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { describeRelease, releaseSelected, type PreparedRelease, type ReleasedPayout, type ReleaseResult } from "@/components/release-flow";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill, type PillTone } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import type { Payout, Submission } from "@/db/schema";
import { isReadyToPay, type SubmissionCounts } from "@/domain/campaign-status";
import { reasonLabel } from "@/domain/rubric";
import { signTransaction } from "@/wallet/kit";
import { plural } from "./campaign-phase";
import { payoutsCall } from "./funder-api";
import { freeSlots } from "./kit";

export interface BoardRow {
  submissionId: string;
  shortId: string;
  workUrl: string;
  contributor: string;
  /** Formatted on the server, so the table renders the same on both sides. */
  submitted: string;
  status: Submission["status"];
  outcome: "PASS" | "FAIL" | null;
  reasonCode: string | null;
  note: string | null;
  decisionId: string | null;
  payoutStatus: Payout["status"] | null;
  releaseTxHash: string | null;
  /** The payout's milestone on chain, once one is appended. */
  milestoneIndex: number | null;
}

type Tab = "all" | "review" | "ready" | "signature" | "paid" | "rejected";

const TABS: Array<{ id: Tab; label: string; count: (c: SubmissionCounts) => number; match: (r: BoardRow) => boolean }> = [
  { id: "all", label: "All", count: (c) => c.total, match: () => true },
  { id: "review", label: "In review", count: (c) => c.inReview, match: (r) => r.status === "pending" || r.status === "appealed" },
  { id: "ready", label: "Ready to pay", count: (c) => c.readyToPay, match: (r) => isReadyToPay(r) },
  { id: "signature", label: "Awaiting signature", count: (c) => c.awaitingSignature, match: (r) => r.payoutStatus === "approved" },
  { id: "paid", label: "Paid", count: (c) => c.paid, match: (r) => r.payoutStatus === "released" },
  { id: "rejected", label: "Rejected", count: (c) => c.rejected, match: (r) => r.status === "rejected" },
];

/** Who may approve and release on a founder-sealed campaign, for a viewer who is not that wallet. */
export interface PayLock {
  /** The campaign's release signer, the only wallet the payouts route accepts for rewards; null when none is set. */
  founder: string | null;
  /** The sealed review page, when the feature is on. */
  sealedHref: string | null;
}

/** The escrow's shape as the page knows it: the budget funded into it and the reward each milestone pays. Decimal strings. */
export interface EscrowShape {
  budget: string;
  reward: string;
}

/**
 * The rows the bar can act on: passes to approve and approved payouts to
 * release. Nothing once the campaign is closed, and nothing for a viewer the
 * payouts route would refuse (`locked`: a founder-sealed campaign seen by
 * anyone but its founder wallet).
 */
function actionable(rows: readonly BoardRow[], closed: boolean, locked: boolean): { eligible: BoardRow[]; releasable: BoardRow[] } {
  // A stuck or failed payout can be selected again: the server resumes it from chain state.
  if (closed || locked) return { eligible: [], releasable: [] };
  return { eligible: rows.filter((r) => isReadyToPay(r) && r.outcome === "PASS"), releasable: rows.filter((r) => r.payoutStatus === "approved") };
}

/** A pass that needs a new milestone on chain: no payout run has started for it. */
const needsMilestone = (r: BoardRow) => r.payoutStatus === null;

/**
 * The passes to tick for "Select the N ready": every one whose milestone is
 * already on chain (resuming it costs no room), then new ones oldest first
 * while the escrow has room. Rows arrive oldest first.
 */
function approvePick(eligible: readonly BoardRow[], free: number): string[] {
  const resumed = eligible.filter((r) => !needsMilestone(r));
  const fresh = eligible.filter(needsMilestone).slice(0, free);
  return [...resumed, ...fresh].map((r) => r.submissionId);
}

interface Selection {
  tab: Tab;
  setTab: (t: Tab) => void;
  selected: ReadonlySet<string>;
  setSelected: (next: ReadonlySet<string>) => void;
  /** What "Select the N ready" ticks: capped at what the escrow covers. */
  pick: string[];
  /** Every pass ready to approve, covered or not. */
  eligible: number;
  /** New rewards the escrow still covers; passes already started on chain need none. */
  free: number;
  releasable: string[];
}

const SelectionContext = createContext<Selection | null>(null);

/** The id of the board, for aria-controls. */
const BOARD_ID = "submissions";
/** The board section's heading, which the Next step panel scrolls to and focuses. The page puts it on the section's h2. */
export const BOARD_HEADING_ID = "submissions-heading";

/**
 * Holds the board's filter and ticked rows, so the Next step panel above the
 * board can set them: its one button filters the board and ticks the rows the
 * step is about. Selection only, client-side; nothing is sent.
 */
export function BoardSelection({
  rows,
  closed,
  escrow,
  payLock = null,
  children,
}: {
  rows: BoardRow[];
  closed: boolean;
  escrow: EscrowShape;
  payLock?: PayLock | null;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { eligible, releasable } = actionable(rows, closed, payLock !== null);
  const free = freeSlots(rows, escrow);
  return (
    <SelectionContext
      value={{
        tab,
        setTab,
        selected,
        setSelected,
        pick: approvePick(eligible, free),
        eligible: eligible.length,
        free,
        releasable: releasable.map((r) => r.submissionId),
      }}
    >
      {children}
    </SelectionContext>
  );
}

/**
 * The Next step panel's control for Approve and Release: filters the board to
 * the rows the step is about and ticks them, so the bar under the board is
 * live. Approve ticks only as many passes as the escrow can cover, oldest
 * first. It only selects; Approve and Release stay the board's own buttons.
 */
export function SelectForStep({ kind }: { kind: "approve" | "release" }) {
  const ctx = useContext(SelectionContext);
  if (!ctx) return null;
  const ids = kind === "approve" ? ctx.pick : ctx.releasable;
  if (kind === "approve" && ids.length === 0 && ctx.eligible > 0) {
    return <p className="text-[14px] text-white/70">The escrow has no room left for another reward, so these passes can&apos;t be approved.</p>;
  }
  if (ids.length === 0) return null;
  const tab: Tab = kind === "approve" ? "ready" : "signature";
  const done = ctx.tab === tab && ids.every((id) => ctx.selected.has(id)) && ctx.selected.size === ids.length;
  const capped = kind === "approve" && ids.length < ctx.eligible;
  const go = () => {
    ctx.setTab(tab);
    ctx.setSelected(new Set(ids));
    // The section heading takes focus, so a screen reader lands on the board; its scroll margin clears the sticky phone header.
    const heading = document.getElementById(BOARD_HEADING_ID);
    if (heading) {
      heading.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      heading.focus({ preventScroll: true });
    }
  };
  const what = kind === "approve" ? "ready" : "approved";
  return (
    <div className="space-y-2.5">
      <Button variant={done ? "secondary" : "primary"} onClick={go} aria-controls={BOARD_ID}>
        {done ? `${ids.length} selected · go to the bar ↓` : capped ? `Select ${ids.length} of ${ctx.eligible}` : `Select the ${ids.length} ${what}`}
      </Button>
      {capped ? <p className="text-[13px] text-white/60">{cappedNote(ids.length - Math.min(ctx.free, ids.length), ctx.free)}</p> : null}
    </div>
  );
}

/**
 * Why "Select K of N" ticks fewer than every pass: passes already started on
 * chain cost no room and come first, then new ones, oldest first, as far as
 * the escrow covers.
 */
function cappedNote(resumed: number, free: number): string {
  const started = resumed > 0 ? `${plural(resumed, "pass", "passes")} already started on chain ${resumed === 1 ? "needs" : "need"} no new room` : "";
  if (free === 0) return `The escrow has no room for another reward; ${started}.`;
  const covers = `The escrow covers ${plural(free, "more reward", "more rewards")}, so the oldest new passes come first`;
  return started ? `${covers}; ${started}.` : `${covers}.`;
}

function payoutPill(r: BoardRow): { tone: PillTone; label: string } | null {
  switch (r.payoutStatus) {
    case "released":
      return { tone: "chain", label: "Paid" };
    case "approved":
      // Approved on chain, not paid yet: yellow is kept for money that moved.
      return { tone: "wait", label: "Awaiting your signature" };
    case "milestone_added":
    case "delivered":
      return { tone: "wait", label: "Started · approve again" };
    case "failed":
      return { tone: "fail", label: "Failed · approve again" };
    case null:
      return r.status === "decided" ? { tone: "wait", label: "Ready to pay" } : null;
  }
}

function reviewPill(r: BoardRow): { tone: PillTone; label: string } {
  if (r.status === "pending") return { tone: "wait", label: "In review" };
  if (r.status === "appealed") return { tone: "wait", label: "Re-review" };
  // Rejected by the close without a decision: no reviewer ever scored it.
  if (r.status === "rejected" && r.outcome === null) return { tone: "wait", label: "Closed unreviewed" };
  return r.outcome === "PASS" ? { tone: "pass", label: "PASS" } : { tone: "fail", label: "FAIL" };
}

/**
 * The funder's submissions table and the two payout actions on one
 * selection: Approve N (the selected passes, no money moves) and Release N
 * (the selected approved payouts, one wallet signature each). Each acts only
 * on the selected rows it applies to.
 */
export function SubmissionsBoard({
  campaignId,
  funderPubkey,
  rows,
  counts,
  closed,
  escrow,
  payLock = null,
}: {
  campaignId: string;
  funderPubkey: string;
  rows: BoardRow[];
  counts: SubmissionCounts;
  closed: boolean;
  escrow: EscrowShape;
  /** Set on a founder-sealed campaign the viewer may not pay out: the rows are read-only and the bar is a note. */
  payLock?: PayLock | null;
}) {
  const router = useRouter();
  const shared = useContext(SelectionContext);
  const [ownTab, setOwnTab] = useState<Tab>("all");
  const [ownSelected, setOwnSelected] = useState<ReadonlySet<string>>(new Set());
  const tab = shared ? shared.tab : ownTab;
  const setTab = shared ? shared.setTab : setOwnTab;
  const selected = shared ? shared.selected : ownSelected;
  const setSelected = shared ? shared.setSelected : setOwnSelected;
  const [busy, setBusy] = useState<"approve" | "release" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "pass" | "fail"; text: string } | null>(null);
  const [outcome, setOutcome] = useState<{ result: ReleaseResult; total: number } | null>(null);

  const { eligible, releasable } = actionable(rows, closed, payLock !== null);
  const selectable = new Set([...eligible, ...releasable].map((r) => r.submissionId));
  const toApprove = eligible.filter((r) => selected.has(r.submissionId));
  const toRelease = releasable.filter((r) => selected.has(r.submissionId)).map((r) => r.submissionId);
  const matchOf = (t: Tab) => TABS.find((x) => x.id === t)?.match ?? (() => true);
  const visible = rows.filter(matchOf(tab));

  // The approve guard refuses the whole batch when the escrow can't cover its new milestones; say so before the click.
  const free = freeSlots(rows, escrow);
  const fresh = toApprove.filter(needsMilestone).length;
  const overBy = Math.max(0, fresh - free);

  const anySelectable = visible.some((r) => selectable.has(r.submissionId));
  const announce = toApprove.length + toRelease.length;
  const idle = busy === null && announce === 0;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  // A filter shows only its rows, so a tick the new filter hides is dropped: the bar never acts on rows out of sight.
  function changeTab(t: Tab) {
    setTab(t);
    const shown = new Set(rows.filter(matchOf(t)).map((r) => r.submissionId));
    const kept = [...selected].filter((id) => shown.has(id));
    if (kept.length !== selected.size) setSelected(new Set(kept));
  }

  function reset() {
    setNotice(null);
    setOutcome(null);
  }

  // The approved rows stay selected and the board moves to the signature filter, so the next click releases them.
  async function approve() {
    const ids = toApprove.map((r) => r.submissionId);
    reset();
    setBusy("approve");
    try {
      await payoutsCall(campaignId, { action: "approve", submissionIds: ids });
      setNotice({ tone: "pass", text: `${plural(ids.length, "payout", "payouts")} approved on chain; no money moved. Release to pay.` });
      setTab("signature");
    } catch (e) {
      setNotice({ tone: "fail", text: e instanceof Error ? e.message : "approve failed" });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function release() {
    const ids = [...toRelease];
    reset();
    setBusy("release");
    try {
      const result = await releaseSelected({
        submissionIds: ids,
        prepare: async (submissionIds) => (await payoutsCall<{ ops: PreparedRelease[] }>(campaignId, { action: "prepare", kind: "release", submissionIds })).ops[0] ?? null,
        sign: (xdr) => signTransaction(funderPubkey, xdr),
        submit: (op) => payoutsCall<ReleasedPayout>(campaignId, { action: "submit", kind: "release", ...op }),
        onProgress: (n, total) => setProgress(`Signing ${n} of ${total}…`),
      });
      setOutcome({ result, total: ids.length });
    } catch (e) {
      // releaseSelected reports every step's failure in its result; this is only a bug guard.
      setNotice({ tone: "fail", text: e instanceof Error ? e.message : "release failed" });
    } finally {
      setProgress(null);
      setBusy(null);
      router.refresh();
    }
  }

  const status =
    busy !== null ? "" : overBy > 0 ? `${announce} selected · the escrow covers ${plural(free, "new reward", "new rewards")}; untick ${overBy}` : announce > 0 ? `${announce} selected` : "Tick rows to act on them";

  return (
    <div id={BOARD_ID} className="space-y-4">
      <div role="group" aria-label="Filter submissions" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => changeTab(t.id)}
              className={cx(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition-colors duration-200",
                active ? "bg-paper text-paper-ink" : "border border-white/10 text-white/55 hover:border-white/25 hover:text-text",
              )}
            >
              {t.label}
              <span className={cx("font-mono text-[11px]", active ? "text-black/60" : "text-white/55")}>{t.count(counts)}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-[22px] border border-dashed border-white/12 px-5 py-10 text-center text-sm text-white/60">
          {rows.length === 0 ? "No submissions yet." : "Nothing in this view."}
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-[24px] border border-white/[0.07] bg-[#0d0d0d]">
          <table className="w-full text-left text-sm">
            <thead className="hidden border-b border-white/[0.07] md:table-header-group">
              <tr className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/55">
                {anySelectable ? (
                  <th scope="col" className="w-10 py-3 pl-5 pr-0">
                    <span className="sr-only">Select</span>
                  </th>
                ) : null}
                <th scope="col" className={cx("py-3 pr-3 font-medium", anySelectable ? "pl-3" : "pl-5")}>Submission</th>
                <th scope="col" className="px-3 py-3 font-medium">Review</th>
                <th scope="col" className="py-3 pl-3 pr-5 font-medium">Payout</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Row
                  key={r.submissionId}
                  r={r}
                  gutter={anySelectable}
                  selectable={selectable.has(r.submissionId)}
                  selected={selected.has(r.submissionId)}
                  onToggle={toggle}
                  disabled={busy !== null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!closed && payLock ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[22px] border border-white/[0.07] bg-white/[0.03] px-5 py-4 text-[14px] leading-relaxed text-white/70">
          {payLock.founder ? (
            <>
              <span>Founder-sealed review: the founder wallet</span>
              <HashChip value={payLock.founder} head={4} tail={4} href={publicEnv.explorerAccountUrl(payLock.founder)} />
              <span>approves and releases these payouts. They are read-only here.</span>
            </>
          ) : (
            <span>Founder-sealed review, but this campaign has no founder wallet set, so its payouts can&apos;t be approved.</span>
          )}
          {payLock.sealedHref ? (
            <Link className="font-semibold text-text underline decoration-white/30 underline-offset-4 hover:decoration-white" href={payLock.sealedHref}>
              Open sealed reviews →
            </Link>
          ) : null}
        </div>
      ) : !closed ? (
        // A solid strip under the bar, so rows never show through it and the last row can scroll clear of it.
        // On a phone the bar shows only once a row is ticked; its status line stays in the accessibility tree, so the first tick is announced.
        <div className={cx("sticky bottom-0 z-10 -mx-1 bg-[linear-gradient(to_top,var(--color-canvas)_70%,transparent)] px-1 pb-4 pt-6", idle && "max-sm:sr-only")}>
          <div className="flex flex-wrap items-center gap-2 rounded-[26px] border border-white/12 bg-[#151515] p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] sm:gap-3 sm:pr-5">
            <Button
              size="sm"
              className="flex-1 sm:flex-none"
              disabled={busy !== null || toApprove.length === 0 || overBy > 0}
              busy={busy === "approve"}
              busyLabel="Adding milestones…"
              onClick={() => void approve()}
            >
              {`Approve ${toApprove.length} for payout`}
            </Button>
            <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" disabled={busy !== null || toRelease.length === 0} busy={busy === "release"} busyLabel={progress ?? "Preparing…"} onClick={() => void release()}>
              {`Release ${plural(toRelease.length, "payout", "payouts")}`}
            </Button>
            <span
              role="status"
              className={cx(
                // Inset from the bar's rounded ends, so a line that wraps under the buttons never runs into the curve.
                "px-3 font-mono",
                idle ? "text-[11px] uppercase tracking-[0.14em] text-white/55" : "w-full pb-1 text-center text-[12px] sm:w-auto sm:pb-0",
                overBy > 0 ? "text-fail" : !idle && "text-text",
              )}
            >
              {status}
            </span>
          </div>
        </div>
      ) : null}
      {!closed && releasable.length > 0 && toRelease.length === 0 ? <p className="text-sm text-white/60">Tick the approved rows to release them.</p> : null}
      {!closed && counts.inReview > 0 ? (
        <p className="text-sm text-white/60">
          {plural(counts.inReview, "submission", "submissions")} awaiting review. Score them on the{" "}
          <Link className="text-text underline decoration-white/30 underline-offset-4 hover:decoration-white" href="/review">
            review page
          </Link>
          {payLock ? "." : ", then approve the passes here."}
        </p>
      ) : null}

      {outcome ? <ReleaseOutcomeLine result={outcome.result} total={outcome.total} rows={rows} /> : null}
      {notice ? (
        <p role={notice.tone === "fail" ? "alert" : "status"} className={cx("text-sm", notice.tone === "fail" ? "text-fail" : "text-accent")}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}

const TONE = { ok: "text-accent", muted: "text-white/60", fail: "text-fail" } as const;

/** What a release run did: every payout released with its tx link, then what was not sent and why. */
function ReleaseOutcomeLine({ result, total, rows }: { result: ReleaseResult; total: number; rows: BoardRow[] }) {
  const o = describeRelease(result, total);
  return (
    <p role="status" className={cx("text-sm", TONE[o.tone])}>
      {o.headline ? (
        <>
          {o.headline} (
          {result.released.map((r, i) => (
            <span key={r.txHash}>
              {i > 0 ? ", " : null}
              <a className="underline" href={publicEnv.explorerTxUrl(r.txHash)} target="_blank" rel="noreferrer">
                {rows.find((row) => row.milestoneIndex === r.milestoneIndex)?.shortId ?? `#${r.milestoneIndex}`}
              </a>
            </span>
          ))}
          ).{o.detail ? " " : null}
        </>
      ) : null}
      {o.detail}
    </p>
  );
}

const TONE_CHIP: Record<PillTone, string> = {
  live: "text-white border-white/30",
  pass: "text-pass bg-pass-soft border-pass-line hover:border-pass",
  fail: "text-fail bg-fail-soft border-fail-line hover:border-fail",
  wait: "text-muted bg-white/3 border-line-strong hover:border-white/40",
  chain: "text-accent bg-accent-soft border-accent-line",
};

/** The review outcome, and when a decision is on record, the link to verify it, as one chip. */
function ReviewChip({ r }: { r: BoardRow }) {
  const review = reviewPill(r);
  if (!r.decisionId) return <Pill tone={review.tone}>{review.label}</Pill>;
  return (
    <Link
      href={`/verify/${r.decisionId}`}
      title="Verify decision"
      className={cx(
        "inline-flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-full border px-[11px] font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150",
        TONE_CHIP[review.tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {review.label}
      <span aria-hidden="true" className="-mr-0.5 font-sans text-[12px] font-medium normal-case tracking-normal opacity-70">
        verify →
      </span>
      <span className="sr-only">, verify decision</span>
    </Link>
  );
}

/** A paid row's status and release transaction as one yellow link chip, for the phone card: "Paid · 9ba5… ↗". */
function PaidLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a
      href={publicEnv.explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      title={hash}
      className={cx(
        "inline-flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-full border px-[11px] font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 md:hidden",
        TONE_CHIP.chain,
        "hover:border-accent",
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
      <span aria-hidden="true" className="font-medium normal-case tracking-normal opacity-80">{`· ${hash.slice(0, 4)}… ↗`}</span>
      <span className="sr-only">{`, release transaction ${hash}`}</span>
    </a>
  );
}

/**
 * One submission. Desktop: a table row of when and who, the review chip, the
 * payout and a reason toggle. Phone: the same cells wrap into a short card:
 * when and who on top, then the review and payout chips on one wrapping line;
 * the checkbox, only on rows it can act on, sits in the card's top corner so
 * every card keeps the same left edge. The reviewer's reason opens on demand.
 */
function Row({
  r,
  gutter,
  selectable,
  selected,
  onToggle,
  disabled,
}: {
  r: BoardRow;
  gutter: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const payout = payoutPill(r);
  const reason = r.reasonCode && r.reasonCode !== "R00_PASS" ? reasonLabel(r.reasonCode) : null;
  const note = r.note && r.status !== "pending" ? r.note : null;
  const why = reason !== null || note !== null;
  const cols = gutter ? 4 : 3;

  return (
    <>
      <tr
        className={cx(
          "relative flex flex-wrap items-center gap-x-2 gap-y-2.5 border-t border-white/[0.06] px-4 py-3.5 align-middle transition-colors duration-200 first:border-t-0 md:table-row md:p-0",
          selected ? "bg-accent/[0.06]" : "hover:bg-white/[0.02]",
        )}
      >
        {gutter ? (
          <td className={cx("absolute right-1.5 top-1.5 md:static md:w-10 md:py-3 md:pl-5 md:pr-0", !selectable && "hidden md:table-cell")}>
            {selectable ? (
              // A 44px target on a phone; the box itself stays 18px.
              <label className="grid size-11 cursor-pointer place-items-center md:block md:size-auto">
                <input
                  type="checkbox"
                  aria-label={`Select ${r.shortId}`}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onToggle(r.submissionId)}
                  className="size-[18px] cursor-pointer align-middle accent-[var(--color-accent)]"
                />
              </label>
            ) : null}
          </td>
        ) : null}
        <td className={cx("min-w-0 basis-full md:w-[1%] md:py-3 md:pr-3", gutter ? "md:pl-3" : "md:pl-5", selectable && "pr-10")}>
          {/* When it came in leads, on one line; the id (the link to the post) and the wallet sit under it. */}
          <p className="whitespace-nowrap text-[13px] font-medium leading-snug text-text">{r.submitted}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-nowrap">
            <a href={r.workUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1 font-mono text-[12px] text-white/60 hover:text-text">
              {r.shortId} <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens the post on X)</span>
            </a>
            <HashChip value={r.contributor} head={4} tail={4} href={publicEnv.explorerAccountUrl(r.contributor)} />
          </div>
        </td>
        {/* On a phone this cell and the payout cell dissolve into the card's flex row, so their chips share one wrapping line. */}
        <td className="max-md:contents md:px-3 md:py-3">
          {/* The outcome links to its proof; the reviewer's reason opens beside it. */}
          <div className="flex items-center gap-1.5 max-md:contents">
            <ReviewChip r={r} />
            {why ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={detailId}
                onClick={() => setOpen((v) => !v)}
                className="inline-flex h-[26px] items-center gap-1 rounded-full px-2 text-[12px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-text"
              >
                Why
                <span aria-hidden="true" className={cx("inline-block text-[10px] transition-transform duration-200", open && "rotate-180")}>
                  ▾
                </span>
                <span className="sr-only">{` ${r.shortId}`}</span>
              </button>
            ) : null}
          </div>
        </td>
        <td className="max-md:contents md:py-3 md:pl-3 md:pr-5">
          <div className="flex flex-wrap items-center gap-2 max-md:contents">
            {/* On a phone a paid row's chip and its transaction are one link, so the card keeps its chips on one line; the copy button is desktop only. */}
            {payout && r.releaseTxHash ? <PaidLink label={payout.label} hash={r.releaseTxHash} /> : null}
            {payout ? (
              <Pill tone={payout.tone} className={r.releaseTxHash ? "max-md:hidden" : ""}>
                {payout.label}
              </Pill>
            ) : (
              <span className="hidden text-[12px] text-white/25 md:inline">—</span>
            )}
            {r.releaseTxHash ? <HashChip className="max-md:hidden" value={r.releaseTxHash} head={4} tail={4} href={publicEnv.explorerTxUrl(r.releaseTxHash)} /> : null}
          </div>
        </td>
      </tr>
      {why ? (
        <tr id={detailId} className={cx(open ? "block md:table-row" : "hidden", selected ? "bg-accent/[0.06]" : undefined)}>
          <td colSpan={cols} className="block px-4 pb-4 md:table-cell md:pb-4 md:pl-5 md:pr-5 md:pt-0">
            <div className={cx("rounded-[14px] bg-white/[0.03] px-4 py-3 text-[13px] leading-relaxed", gutter && "md:ml-8")}>
              {reason ? <p className="font-mono text-[11.5px] text-white/60">{reason}</p> : null}
              {note ? <p className={cx("text-white/75 [overflow-wrap:anywhere]", reason && "mt-1")}>{note}</p> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
