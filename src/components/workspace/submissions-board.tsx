"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeRelease, releaseSelected, type PreparedRelease, type ReleasedPayout, type ReleaseResult } from "@/components/release-flow";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill, type PillTone } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import type { Payout, Submission } from "@/db/schema";
import { isReadyToPay, type SubmissionCounts } from "@/domain/campaign-status";
import { signTransaction } from "@/wallet/kit";
import { payoutsCall } from "./funder-api";

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

function payoutPill(r: BoardRow): { tone: PillTone; label: string } | null {
  switch (r.payoutStatus) {
    case "released":
      return { tone: "pass", label: "Paid" };
    case "approved":
      return { tone: "chain", label: "Awaiting your signature" };
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
  return r.outcome === "PASS" ? { tone: "pass", label: "PASS" } : { tone: "fail", label: "FAIL" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
}: {
  campaignId: string;
  funderPubkey: string;
  rows: BoardRow[];
  counts: SubmissionCounts;
  closed: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"approve" | "release" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "pass" | "fail"; text: string } | null>(null);
  const [outcome, setOutcome] = useState<{ result: ReleaseResult; total: number } | null>(null);

  // A stuck or failed payout can be selected again: the server resumes it from chain state.
  const eligible = closed ? [] : rows.filter((r) => isReadyToPay(r) && r.outcome === "PASS");
  const releasable = closed ? [] : rows.filter((r) => r.payoutStatus === "approved");
  const selectable = new Set([...eligible, ...releasable].map((r) => r.submissionId));
  const toApprove = eligible.filter((r) => selected.has(r.submissionId)).map((r) => r.submissionId);
  const toRelease = releasable.filter((r) => selected.has(r.submissionId)).map((r) => r.submissionId);
  const match = TABS.find((t) => t.id === tab)?.match ?? (() => true);
  const visible = rows.filter(match);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reset() {
    setNotice(null);
    setOutcome(null);
  }

  // The approved rows stay selected, so the next click releases them.
  async function approve() {
    const ids = [...toApprove];
    reset();
    setBusy("approve");
    try {
      await payoutsCall(campaignId, { action: "approve", submissionIds: ids });
      setNotice({ tone: "pass", text: `${plural(ids.length, "payout", "payouts")} approved on chain; no money moved. Release to pay.` });
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

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Filter submissions" className="flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cx(
                "-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[13.5px] font-medium transition-colors md:h-10",
                active ? "border-text text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
              <span className={cx("rounded-full px-1.5 font-mono text-[11px]", active ? "bg-white/10 text-text" : "bg-white/5 text-muted")}>{t.count(counts)}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
          {rows.length === 0 ? "No submissions yet." : "Nothing in this view."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="hidden border-b border-line bg-sunken text-[12px] text-muted md:table-header-group">
              <tr>
                <th scope="col" className="w-11 px-3 py-2.5">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">Submission</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Contributor</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Review</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Payout</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Row key={r.submissionId} r={r} selectable={selectable.has(r.submissionId)} selected={selected.has(r.submissionId)} onToggle={toggle} disabled={busy !== null} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!closed ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-raised px-4 py-3">
            <Button size="sm" disabled={busy !== null || toApprove.length === 0} busy={busy === "approve"} busyLabel="Adding milestones…" onClick={() => void approve()}>
              {`Approve ${toApprove.length} for payout`}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy !== null || toRelease.length === 0} busy={busy === "release"} busyLabel={progress ?? "Preparing…"} onClick={() => void release()}>
              {`Release ${plural(toRelease.length, "payout", "payouts")}`}
            </Button>
            {busy === null && toApprove.length + toRelease.length > 0 ? <span className="text-[13px] text-muted">{`${toApprove.length + toRelease.length} selected`}</span> : null}
          </div>
          {releasable.length > 0 && toRelease.length === 0 ? <p className="text-sm text-muted">Tick the approved rows to release them.</p> : null}
          {counts.inReview > 0 ? (
            <p className="text-sm text-muted">
              {plural(counts.inReview, "submission", "submissions")} awaiting review. Score them on the{" "}
              <Link className="text-text underline" href="/review">
                review page
              </Link>
              , then approve the passes here.
            </p>
          ) : null}
        </div>
      ) : null}

      {outcome ? <ReleaseOutcomeLine result={outcome.result} total={outcome.total} rows={rows} /> : null}
      {notice ? (
        <p role={notice.tone === "fail" ? "alert" : "status"} className={cx("text-sm", notice.tone === "fail" ? "text-fail" : "text-pass")}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}

const TONE = { ok: "text-pass", muted: "text-muted", fail: "text-fail" } as const;

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

function Row({ r, selectable, selected, onToggle, disabled }: { r: BoardRow; selectable: boolean; selected: boolean; onToggle: (id: string) => void; disabled: boolean }) {
  const review = reviewPill(r);
  const payout = payoutPill(r);
  const reason = r.reasonCode && r.reasonCode !== "R00_PASS" ? r.reasonCode : null;

  return (
    <tr className={cx("grid grid-cols-[44px_minmax(0,1fr)] border-b border-line align-top last:border-b-0 md:table-row", selected && "bg-white/3")}>
      <td className="row-span-4 px-3 py-3.5">
        {selectable ? (
          <input
            type="checkbox"
            aria-label={`Select ${r.shortId}`}
            checked={selected}
            disabled={disabled}
            onChange={() => onToggle(r.submissionId)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
        ) : null}
      </td>
      <td className="px-3 pt-3.5 md:py-3.5">
        <a href={r.workUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[13px] font-medium text-text hover:underline">
          {r.shortId} <span aria-hidden="true" className="text-muted">↗</span>
          <span className="sr-only">(opens the post on X)</span>
        </a>
        <p className="mt-1 text-[12px] text-muted">{r.submitted}</p>
      </td>
      <td className="px-3 pt-2 md:py-3.5">
        <HashChip value={r.contributor} head={4} tail={4} href={publicEnv.explorerAccountUrl(r.contributor)} />
      </td>
      <td className="px-3 pt-2 md:max-w-[360px] md:py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={review.tone}>{review.label}</Pill>
          {reason ? <span className="font-mono text-[12px] text-text-2">{reason}</span> : null}
        </div>
        {r.note && r.status !== "pending" ? <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-muted [overflow-wrap:anywhere]">{r.note}</p> : null}
        {r.decisionId ? (
          <Link href={`/verify/${r.decisionId}`} className="mt-1 inline-flex min-h-8 items-center text-[12px] font-medium text-text-2 hover:text-text hover:underline">
            Verify decision →
          </Link>
        ) : null}
      </td>
      <td className="px-3 pb-3.5 pt-2 md:py-3.5">
        {payout ? <Pill tone={payout.tone}>{payout.label}</Pill> : <span className="text-[12px] text-faint">—</span>}
        {r.releaseTxHash ? (
          <div className="mt-2">
            <HashChip value={r.releaseTxHash} href={publicEnv.explorerTxUrl(r.releaseTxHash)} />
          </div>
        ) : null}
      </td>
    </tr>
  );
}
