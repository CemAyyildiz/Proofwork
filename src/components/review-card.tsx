"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { evaluate, PASS_THRESHOLD, SIGNALS, type ReasonCode, type SignalId, type Signals } from "@/domain/rubric";

interface Item {
  submissionId: string;
  shortId: string;
  workUrl: string;
  submittedAt: string;
  status: string;
  campaign: { slug: string; title: string; brief: string };
  priorDecision: { outcome: string; reasonCode: string; note: string } | null;
}

/** Wall-clock bookkeeping kept outside render so the component stays pure. */
class ReviewClock {
  private readonly startedAt = Date.now();
  private lastTick = Date.now();
  readonly perSignal: Record<string, number> = {};
  lap(id: string): void {
    const now = Date.now();
    this.perSignal[id] = (this.perSignal[id] ?? 0) + Math.round((now - this.lastTick) / 1000);
    this.lastTick = now;
  }
  totalSeconds(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }
}

const initial = (): Signals => ({
  account_genuine: true,
  content_original: true,
  task_done: true,
  follows_brief: true,
  single_account: true,
  not_spam: true,
});

export function ReviewCard({ item }: { item: Item }) {
  const router = useRouter();
  const [signals, setSignals] = useState<Signals>(initial);
  const [reason, setReason] = useState<ReasonCode | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ outcome: string; txHash: string | null } | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const clock = useRef<ReviewClock | null>(null);
  useEffect(() => {
    clock.current = new ReviewClock();
  }, []);

  const result = useMemo(() => evaluate(signals), [signals]);
  const failedCodes = SIGNALS.filter((s) => result.failed.includes(s.id)).map((s) => s.failCode as ReasonCode);
  const effectiveReason: ReasonCode | "" = result.outcome === "PASS" ? "R00_PASS" : reason;

  function toggle(id: SignalId) {
    clock.current?.lap(id);
    setSignals((s) => ({ ...s, [id]: !s[id] }));
    setReason("");
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: item.submissionId,
          signals,
          reasonCode: effectiveReason,
          note,
          secondsTotal: clock.current?.totalSeconds() ?? 0,
          secondsPerSignal: clock.current?.perSignal ?? {},
        }),
      });
      const json = (await res.json()) as { outcome?: string; txHash?: string | null; message?: string };
      if (!res.ok) throw new Error(json.message ?? "failed");
      setDone({ outcome: json.outcome ?? "?", txHash: json.txHash ?? null });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded border border-green-300 bg-green-50 p-4 text-sm">
        <strong>{item.shortId}</strong> → {done.outcome}
        {done.txHash ? <span className="ml-2 text-xs text-neutral-600">tx {done.txHash.slice(0, 12)}…</span> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <code className="text-xs">{item.shortId}</code>
            <span className="text-xs text-neutral-500">{item.campaign.title}</span>
            {item.status === "appealed" ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">re-review</span> : null}
          </div>
          <a className="underline" href={item.workUrl} target="_blank" rel="noreferrer">{item.workUrl}</a>
        </div>
        <button type="button" onClick={() => setShowBrief((v) => !v)} className="text-xs underline">
          {showBrief ? "hide brief" : "show brief"}
        </button>
      </div>
      {showBrief ? <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs">{item.campaign.brief}</p> : null}
      {item.priorDecision ? (
        <p className="rounded bg-amber-50 p-2 text-xs">
          First pass: {item.priorDecision.outcome} ({item.priorDecision.reasonCode}) — {item.priorDecision.note}
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-2 text-sm">
        {SIGNALS.map((s) => (
          <li key={s.id}>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={signals[s.id]} onChange={() => toggle(s.id)} />
              <span className={signals[s.id] ? "" : "text-red-700 line-through"}>{s.label}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {result.passCount}/{SIGNALS.length} pass → <strong>{result.outcome}</strong> (threshold {PASS_THRESHOLD})
        </span>
        {result.outcome === "FAIL" ? (
          <select value={reason} onChange={(e) => setReason(e.target.value as ReasonCode)} className="rounded border border-neutral-300 px-2 py-1">
            <option value="">primary reason…</option>
            {failedCodes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : null}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="One line the contributor can act on."
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={busy || note.trim().length < 3 || effectiveReason === ""}
        onClick={submit}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Committing on-chain…" : `Record ${result.outcome}`}
      </button>
    </div>
  );
}
