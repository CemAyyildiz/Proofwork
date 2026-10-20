"use client";

import { useEffect, useEffectEvent, useId } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill } from "@/components/ui/pill";
import { PASS_THRESHOLD, reasonLabel, SIGNALS, type ReasonCode, type SignalId, type Signals } from "@/domain/rubric";
import { formatDateShort, formatRelative } from "@/lib/format";
import { commitState, keyAction, type Draft, type ReviewItem } from "./review-state";

/**
 * One submission, scored blind against the six-signal rubric. The card is
 * controlled: the queue holds the draft, so moving away and back keeps every
 * answer. Left: what the reviewer reads (post link, brief, prior decision,
 * funding note). Right: the rubric, score meter, guide and the record button.
 * Keyboard: 1–6 toggle a signal, O opens the post, ⌘/Ctrl + ↵ records once the
 * note rule is met and a reason is set. A held key does not repeat.
 */
export function ReviewCard({
  item,
  draft,
  now,
  busy,
  error,
  onSignal,
  onDraft,
  onRecord,
}: {
  item: ReviewItem;
  draft: Draft;
  /** Server render time, ms: relative dates read the same on server and client. */
  now: number;
  /** The decision is being committed: answers are frozen until it settles. */
  busy: boolean;
  error: string | null;
  onSignal: (id: SignalId, value: boolean) => void;
  onDraft: (next: Draft) => void;
  onRecord: () => void;
}) {
  const state = commitState(draft);
  const ready = !busy && state.blocker === null;

  function setSignal(id: SignalId, value: boolean) {
    if (busy) return;
    onSignal(id, value);
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target instanceof HTMLElement ? { tagName: e.target.tagName, type: (e.target as HTMLInputElement).type, isContentEditable: e.target.isContentEditable } : null;
    const action = keyAction({ key: e.key, repeat: e.repeat, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target });
    if (!action) return;
    e.preventDefault();
    if (action.kind === "record") {
      if (ready) onRecord();
    } else if (action.kind === "toggle") {
      setSignal(action.signal, !draft.signals[action.signal]);
    } else {
      window.open(item.workUrl, "_blank", "noopener,noreferrer");
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_500px]">
      <SubmissionPanel item={item} now={new Date(now)} />

      <section aria-label="Rubric" className="relative rounded-xl border border-line bg-surface p-5 md:p-6">
        <h2 className="sr-only">Rubric</h2>
        <ScoreMeter passCount={state.passCount} outcome={state.outcome} signals={draft.signals} />

        <div className="mt-5 grid gap-2">
          {SIGNALS.map((s, i) => (
            <SignalRow
              key={s.id}
              name={`${item.submissionId}-${s.id}`}
              index={i + 1}
              label={s.label}
              value={draft.signals[s.id]}
              onChange={(v) => setSignal(s.id, v)}
              onFocus={() => {
                if (draft.guide !== s.id) onDraft({ ...draft, guide: s.id });
              }}
            />
          ))}
        </div>

        <RubricGuide id={draft.guide} />

        {state.outcome === "FAIL" ? (
          <label className="mt-5 block">
            <span className="text-[13px] font-medium text-text-2">Primary reason</span>
            <select
              value={state.reasonCode}
              disabled={busy}
              onChange={(e) => onDraft({ ...draft, reason: e.target.value as ReasonCode | "" })}
              className="mt-1.5 h-11 w-full rounded-md border border-line-strong bg-sunken px-3 text-sm text-text"
            >
              <option value="">Pick the main failed signal…</option>
              {state.failedCodes.map((c) => (
                <option key={c} value={c}>
                  {reasonLabel(c)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="mt-5 block">
          <span className="text-[13px] font-medium text-text-2">Note to the contributor</span>
          <textarea
            value={draft.note}
            readOnly={busy}
            onChange={(e) => onDraft({ ...draft, note: e.target.value })}
            rows={2}
            maxLength={1000}
            placeholder="One line the contributor can act on."
            className="mt-1.5 w-full resize-y rounded-md border border-line-strong bg-sunken px-3 py-2.5 text-sm text-text placeholder:text-muted"
          />
        </label>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-fail">
            {error}
          </p>
        ) : null}

        <Button className="mt-4 w-full" disabled={!ready} busy={busy} busyLabel="Committing on-chain…" onClick={() => onRecord()}>
          {`Record ${state.outcome} on-chain`}
        </Button>
        <p className="mt-3 text-center text-[12px] text-muted">{state.blocker ?? "The decision is public the moment it is recorded."}</p>

        <p className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-line pt-4 text-[12px] text-muted">
          <span>
            <Kbd>1</Kbd>–<Kbd>6</Kbd> toggle a signal
          </span>
          <span>
            <Kbd>O</Kbd> open post
          </span>
          <span>
            <Kbd>⌘/Ctrl</Kbd> <Kbd>↵</Kbd> record
          </span>
        </p>
      </section>
    </div>
  );
}

function SubmissionPanel({ item, now }: { item: ReviewItem; now: Date }) {
  const submitted = new Date(item.submittedAt);
  const deadline = new Date(item.campaign.deadlineAt);
  const ended = deadline.getTime() <= now.getTime();
  return (
    <section aria-label="Submission" className="relative min-w-0 rounded-xl border border-line bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[13px] font-medium text-text">{item.shortId}</span>
        {item.status === "appealed" ? <Pill tone="chain">Re-review</Pill> : <Pill tone="wait">Awaiting review</Pill>}
      </div>
      <h2 className="mt-3 text-xl font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">{item.campaign.title}</h2>
      <dl className="mt-3 grid gap-1 text-[13px] text-text-2 sm:grid-cols-2">
        <div>
          <dt className="inline text-muted">Submitted </dt>
          <dd className="inline">
            {formatDateShort(submitted)} · {formatRelative(submitted, now)}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted">{ended ? "Deadline passed " : "Closes "}</dt>
          <dd className="inline">
            {formatDateShort(deadline)} · {formatRelative(deadline, now)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 rounded-lg border border-line bg-sunken p-4">
        <Eyebrow>The post</Eyebrow>
        <p className="mt-2 break-all font-mono text-[12.5px] text-text-2">{item.workUrl}</p>
        <a href={item.workUrl} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "md", "mt-3 w-full sm:w-auto")}>
          Open post on X <span aria-hidden="true">↗</span>
          <span aria-hidden="true">
            <Kbd>O</Kbd>
          </span>
        </a>
        <p className="mt-2 text-[12px] text-muted">Read it on X against the brief below. The post is never embedded here.</p>
      </div>

      {item.priorDecision ? (
        <div className="mt-4 rounded-lg border border-line-strong bg-raised p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <Eyebrow as="span">First decision</Eyebrow>
            <Pill tone={item.priorDecision.outcome === "PASS" ? "pass" : "fail"}>{item.priorDecision.outcome}</Pill>
            <span className="font-mono text-[12px] text-text-2">{reasonLabel(item.priorDecision.reasonCode)}</span>
          </div>
          <p className="mt-2 text-sm text-text">{item.priorDecision.note}</p>
          <p className="mt-2 text-[12px] text-muted">The contributor asked for the one re-review. Score it fresh; both decisions stay on-chain.</p>
        </div>
      ) : null}

      {item.sharedFundingCount === null ? (
        <p className="mt-4 text-[13px] text-muted">Funding source not checked.</p>
      ) : item.sharedFundingCount > 0 ? (
        <p role="note" className="mt-4 rounded-lg border border-line-strong bg-raised p-4 text-[13px] leading-normal text-text-2">
          <strong className="text-text">Shared funding source:</strong>{" "}
          {`${item.sharedFundingCount} other ${item.sharedFundingCount === 1 ? "submission" : "submissions"} in this campaign.`} The wallets were
          first funded by the same account, or one funded the other. Weigh it under the single-account check; no signal has been changed.
        </p>
      ) : null}

      <details open className="group mt-5 border-t border-line pt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-text md:min-h-0">
          Campaign brief
          <span aria-hidden="true" className="text-muted transition-transform duration-150 group-open:rotate-180">
            ▾
          </span>
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-text-2 [overflow-wrap:anywhere]">{item.campaign.brief}</p>
      </details>
    </section>
  );
}

function ScoreMeter({ passCount, outcome, signals }: { passCount: number; outcome: "PASS" | "FAIL"; signals: Signals }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Eyebrow as="h3">Score</Eyebrow>
        <span className="text-[12px] text-muted">{`${PASS_THRESHOLD} of ${SIGNALS.length} needed to pass`}</span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <p className="text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
          {passCount}
          <span className="text-muted"> / {SIGNALS.length}</span>
        </p>
        <Pill tone={outcome === "PASS" ? "pass" : "fail"}>{outcome}</Pill>
        {/* The one announcement per change; the figure and pill above are read in place, not announced. */}
        <span className="sr-only" aria-live="polite">{`${passCount} of ${SIGNALS.length} signals pass. Outcome ${outcome}.`}</span>
      </div>
      <div aria-hidden="true" className="mt-3 flex gap-1.5">
        {SIGNALS.map((s) => (
          <span key={s.id} className={cx("h-1.5 flex-1 rounded-full transition-colors duration-200", signals[s.id] ? "bg-pass" : "bg-fail")} />
        ))}
      </div>
    </div>
  );
}

function SignalRow({
  name,
  index,
  label,
  value,
  onChange,
  onFocus,
}: {
  name: string;
  index: number;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  onFocus: () => void;
}) {
  const labelId = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      onFocus={onFocus}
      className={cx(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors duration-150",
        value ? "border-line bg-sunken" : "border-fail-line bg-fail-soft",
      )}
    >
      <span id={labelId} className="flex min-w-0 items-center gap-2.5 text-sm">
        <Kbd>{String(index)}</Kbd>
        <span className={cx("truncate", value ? "text-text" : "text-fail")}>{label}</span>
      </span>
      <span className="inline-flex shrink-0 rounded-[10px] border border-line-strong bg-canvas p-0.5">
        <Option name={name} checked={value} tone="pass" onSelect={() => onChange(true)}>
          Pass
        </Option>
        <Option name={name} checked={!value} tone="fail" onSelect={() => onChange(false)}>
          Fail
        </Option>
      </span>
    </div>
  );
}

function Option({ name, checked, tone, onSelect, children }: { name: string; checked: boolean; tone: "pass" | "fail"; onSelect: () => void; children: string }) {
  return (
    <label
      className={cx(
        "relative inline-flex h-11 min-w-14 cursor-pointer items-center justify-center rounded-sm px-3 font-mono text-[12px] font-medium uppercase tracking-[0.06em] transition-colors duration-150 md:h-8",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        checked ? (tone === "pass" ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail") : "text-muted hover:text-text",
      )}
    >
      <input type="radio" name={name} value={tone} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

function RubricGuide({ id }: { id: SignalId }) {
  const index = SIGNALS.findIndex((s) => s.id === id);
  const s = SIGNALS[index] ?? SIGNALS[0];
  return (
    <div className="mt-4 rounded-lg border border-line bg-sunken p-4">
      <Eyebrow as="h3">{`Signal ${Math.max(index, 0) + 1} · ${s.label}`}</Eyebrow>
      {/* The question is quoted verbatim from docs/rubric.md, where it continues a sentence; only its first letter is raised here. */}
      <p className="mt-2 text-sm text-text first-letter:uppercase">{s.question}</p>
      <p className="mt-1.5 text-[13px] leading-normal text-text-2">
        <span className="text-fail">Fails when: </span>
        {s.failsWhen}
      </p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line-strong bg-sunken px-1 font-mono text-[11px] font-medium text-muted">
      {children}
    </kbd>
  );
}
