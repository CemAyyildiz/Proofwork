"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import { reasonLabel, type SignalId } from "@/domain/rubric";
import { ReviewCard } from "./review-card";
import {
  commitErrorMessage,
  commitState,
  draftFor,
  leavesQueue,
  nextAfter,
  queueCounts,
  ReviewClock,
  stepFrom,
  withSignal,
  type Draft,
  type Receipt,
  type ReviewItem,
} from "./review-state";

/** How long a receipt stays in place before the next submission comes into focus. */
const RECEIPT_MS = 1500;

/**
 * The blind review queue, one submission at a time, in the server's order.
 * Drafts are kept per submission, so Skip and Previous lose nothing. A
 * recorded item, or one someone else decided first (409), leaves the queue in
 * place; the server list is refreshed only once nothing is left, so the card
 * being scored is never swapped out under the reviewer.
 */
export function ReviewQueue({ items, now }: { items: ReviewItem[]; now: number }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [showing, setShowing] = useState<{ receipt: Receipt; next: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const clocks = useRef(new Map<string, ReviewClock>());
  const focusTarget = useRef<HTMLDivElement>(null);
  const firstFocus = useRef(true);

  const open = items.filter((i) => !recorded.has(i.submissionId) && !gone.has(i.submissionId));
  const ids = open.map((i) => i.submissionId);
  const current = open.find((i) => i.submissionId === currentId) ?? open[0] ?? null;
  const activeId = showing ? null : (current?.submissionId ?? null);
  const counts = queueCounts(items, recorded, gone, activeId);

  // Time is booked to an item only while it is on screen.
  useEffect(() => {
    if (!activeId) return;
    const clock = clocks.current.get(activeId) ?? new ReviewClock();
    clocks.current.set(activeId, clock);
    clock.resume(Date.now());
    return () => clock.pause(Date.now());
  }, [activeId]);

  // The next submission comes into focus; the first one on page load does not steal it.
  useEffect(() => {
    if (!activeId) return;
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    focusTarget.current?.focus();
  }, [activeId]);

  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(() => {
      setCurrentId(showing.next);
      setShowing(null);
    }, RECEIPT_MS);
    return () => clearTimeout(t);
  }, [showing]);

  // Only once the queue is empty does the page ask the server for anything that arrived meanwhile.
  const cleared = !showing && open.length === 0 && recorded.size + gone.size > 0;
  useEffect(() => {
    if (cleared) router.refresh();
  }, [cleared, router]);

  function setDraft(id: string, next: Draft) {
    setDrafts((d) => new Map(d).set(id, next));
  }

  function onSignal(id: string, signal: SignalId, value: boolean) {
    const draft = draftFor(drafts, id);
    if (draft.signals[signal] !== value) clocks.current.get(id)?.lap(signal, Date.now());
    setDraft(id, withSignal(draft, signal, value));
  }

  function go(delta: number) {
    if (!current || busyId) return;
    setNotice(null);
    setCurrentId(stepFrom(ids, current.submissionId, delta));
  }

  async function record(item: ReviewItem) {
    const id = item.submissionId;
    const draft = draftFor(drafts, id);
    const state = commitState(draft);
    // The button is disabled and the shortcut checks too; this is the last guard before anything is sent.
    if (busyId !== null || state.blocker !== null || state.reasonCode === "") return;
    setBusyId(id);
    setError(null);
    setNotice(null);
    const clock = clocks.current.get(id);
    const at = Date.now();
    let status = 0;
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: id,
          signals: draft.signals,
          reasonCode: state.reasonCode,
          note: draft.note,
          secondsTotal: clock?.totalSeconds(at) ?? 0,
          secondsPerSignal: clock?.perSignal ?? {},
          // What this card showed, so the log records the warning the reviewer saw.
          sharedFundingCount: item.sharedFundingCount,
        }),
      });
      status = res.status;
      const json = (await res.json().catch(() => ({}))) as { id?: unknown; outcome?: unknown; reasonCode?: unknown; txHash?: unknown; message?: unknown };
      const message = typeof json.message === "string" ? json.message : null;
      if (res.ok && typeof json.id === "string") {
        const receipt: Receipt = {
          submissionId: id,
          shortId: item.shortId,
          campaignId: item.campaign.id,
          outcome: json.outcome === "PASS" ? "PASS" : "FAIL",
          reasonCode: typeof json.reasonCode === "string" ? json.reasonCode : state.reasonCode,
          decisionId: json.id,
          txHash: typeof json.txHash === "string" && json.txHash !== "" ? json.txHash : null,
        };
        setShowing({ receipt, next: nextAfter(ids, id) });
        setRecorded((r) => new Set(r).add(id));
        return;
      }
      if (leavesQueue(status)) {
        setGone((g) => new Set(g).add(id));
        setCurrentId(nextAfter(ids, id));
        setNotice(commitErrorMessage(status, message));
        return;
      }
      setError({ id, message: commitErrorMessage(res.ok ? 500 : status, message) });
    } catch {
      setError({ id, message: commitErrorMessage(status, null) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className="rounded-lg border border-line-strong bg-raised px-4 py-3 text-sm text-text-2">
          {notice}
        </p>
      ) : null}

      {showing ? (
        <ReceiptCard
          receipt={showing.receipt}
          hasNext={showing.next !== null}
          onNext={() => {
            setCurrentId(showing.next);
            setShowing(null);
          }}
        />
      ) : current ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[12.5px] text-muted" aria-live="polite">
              <span className="text-text-2">{`${counts.position} of ${counts.total}`}</span>
              {` · ${counts.waiting} waiting · Blind review · order randomised`}
            </p>
            {ids.length > 1 ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={busyId !== null} onClick={() => go(-1)}>
                  <span aria-hidden="true">←</span> Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={busyId !== null} onClick={() => go(1)}>
                  Skip <span aria-hidden="true">→</span>
                </Button>
              </div>
            ) : null}
          </div>
          <div ref={focusTarget} tabIndex={-1} aria-label={`Submission ${current.shortId}`} className="outline-none">
            <ReviewCard
              key={current.submissionId}
              item={current}
              draft={draftFor(drafts, current.submissionId)}
              now={now}
              busy={busyId === current.submissionId}
              error={error?.id === current.submissionId ? error.message : null}
              onSignal={(signal, value) => onSignal(current.submissionId, signal, value)}
              onDraft={(next) => setDraft(current.submissionId, next)}
              onRecord={() => void record(current)}
            />
          </div>
        </div>
      ) : (
        <EmptyQueue />
      )}
    </div>
  );
}

export function EmptyQueue() {
  return (
    <Card className="p-8 text-center">
      <p className="text-lg font-semibold tracking-[-0.02em]">Nothing to review.</p>
      <p className="mt-2 text-sm text-muted">New submissions appear here in random order.</p>
    </Card>
  );
}

/** The recorded decision, for about RECEIPT_MS. "On-chain" is said only when there is a transaction hash to show. */
function ReceiptCard({ receipt, hasNext, onNext }: { receipt: Receipt; hasNext: boolean; onNext: () => void }) {
  return (
    <Card className="p-6 md:p-8" role="status">
      <Eyebrow>{receipt.txHash ? "Recorded on-chain" : "Recorded"}</Eyebrow>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[15px] font-medium">{receipt.shortId}</span>
        <span aria-hidden="true" className="text-muted">
          →
        </span>
        <Pill tone={receipt.outcome === "PASS" ? "pass" : "fail"}>{receipt.outcome}</Pill>
        <span className="font-mono text-[12.5px] text-text-2">{reasonLabel(receipt.reasonCode)}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {receipt.txHash ? (
          <HashChip value={receipt.txHash} href={publicEnv.explorerTxUrl(receipt.txHash)} />
        ) : (
          <a
            href={`/api/campaigns/${encodeURIComponent(receipt.campaignId)}/review-log`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-text-2 hover:text-text hover:underline md:min-h-0"
          >
            No transaction hash yet. See the review log
          </a>
        )}
        <Link href={`/verify/${receipt.decisionId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline md:min-h-0">
          Verify decision <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="mt-6">
        <Button variant="secondary" size="sm" onClick={onNext}>
          {hasNext ? "Next submission" : "Done"}
        </Button>
      </div>
    </Card>
  );
}
