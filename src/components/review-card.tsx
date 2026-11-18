"use client";

import { useEffect, useEffectEvent, useId } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { ax, Pieces } from "@/components/workspace/kit";
import { PASS_THRESHOLD, reasonLabel, RUBRIC_VERSION, SIGNALS, type ReasonCode, type SignalId } from "@/domain/rubric";
import { formatDateShort, formatRelative } from "@/lib/format";
import { commitState, keyAction, type Draft, type ReviewItem } from "./review-state";

/**
 * One submission, scored blind against the six-signal rubric. The card is
 * controlled: the queue holds the draft, so moving away and back keeps every
 * answer. Left, on paper: what the reviewer reads (post link, brief, prior
 * decision, funding note). Right: the yes count against the pass line, the
 * six yes/no toggles, the guide and the record button.
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
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
      <SubmissionPanel item={item} now={new Date(now)} />

      <section aria-label="Rubric" className="relative min-w-0 rounded-[30px] border border-white/[0.08] bg-[#0d0d0d] p-5 md:p-7">
        <h2 className="sr-only">{`Rubric ${RUBRIC_VERSION}`}</h2>
        <ScoreMeter signals={draft.signals} passCount={state.passCount} outcome={state.outcome} />

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-2">
          {SIGNALS.map((s, i) => (
            <SignalRow
              key={s.id}
              name={`${item.submissionId}-${s.id}`}
              index={i + 1}
              label={s.label}
              question={s.question}
              value={draft.signals[s.id]}
              focused={draft.guide === s.id}
              disabled={busy}
              onChange={(v) => setSignal(s.id, v)}
              onFocus={() => {
                if (draft.guide !== s.id) onDraft({ ...draft, guide: s.id });
              }}
            />
          ))}
        </div>

        <RubricGuide id={draft.guide} />

        {state.outcome === "FAIL" ? (
          <label className="mt-6 block">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Primary reason</span>
            <select
              value={state.reasonCode}
              disabled={busy}
              onChange={(e) => onDraft({ ...draft, reason: e.target.value as ReasonCode | "" })}
              className={cx(
                "mt-2 h-12 w-full rounded-[16px] border bg-white/[0.03] px-4 text-[15px] text-text outline-none focus-visible:border-accent",
                state.reasonCode === "" ? "border-fail-line" : "border-white/10",
              )}
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

        <label className="mt-6 block">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Note to the contributor</span>
          <textarea
            value={draft.note}
            readOnly={busy}
            onChange={(e) => onDraft({ ...draft, note: e.target.value })}
            rows={2}
            maxLength={1000}
            placeholder="One line the contributor can act on."
            className="mt-2 w-full resize-y rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[15px] leading-relaxed text-text outline-none placeholder:text-white/40 focus-visible:border-accent"
          />
        </label>

        {error ? (
          <p role="alert" className="mt-4 rounded-2xl border border-fail-line bg-fail-soft px-4 py-3 text-sm text-fail">
            {error}
          </p>
        ) : null}

        <Button className="mt-5 h-14 w-full text-[16px]" disabled={!ready} busy={busy} busyLabel="Committing on-chain…" onClick={() => onRecord()}>
          {`Record ${state.outcome} on-chain`}
        </Button>
        <p className={cx("mt-3 text-center text-[13px]", state.blocker ? "text-white/70" : "text-white/60")}>{state.blocker ?? "The decision is public the moment it is recorded."}</p>

        {/* Keyboard hints only where there is a keyboard to press them: hidden on touch screens. */}
        <p className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1.5 border-t border-white/[0.06] pt-5 text-[12px] text-white/60 [@media(hover:none)]:hidden">
          <span className="inline-flex items-center gap-1">
            <Kbd>1</Kbd>–<Kbd>6</Kbd> toggle a signal
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>O</Kbd> open post
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>⌘/Ctrl</Kbd> <Kbd>↵</Kbd> record
          </span>
        </p>
      </section>
    </div>
  );
}

/** The handle and status id of an allow-listed x.com / twitter.com link, for the post card; null when the link reads otherwise. */
function postParts(url: string): { handle: string; id: string } | null {
  const m = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(url);
  return m && m[1] && m[2] ? { handle: m[1], id: m[2] } : null;
}

function SubmissionPanel({ item, now }: { item: ReviewItem; now: Date }) {
  const submitted = new Date(item.submittedAt);
  const deadline = new Date(item.campaign.deadlineAt);
  const ended = deadline.getTime() <= now.getTime();
  const post = postParts(item.workUrl);
  return (
    <section aria-label="Submission" data-surface="paper" className="relative min-w-0 rounded-[30px] bg-paper p-5 text-paper-ink md:p-7 xl:sticky xl:top-8">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[13px] font-semibold">{item.shortId}</span>
        {item.status === "appealed" ? (
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-black px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            Re-review
          </span>
        ) : (
          <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-black/20 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-black/65">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            Awaiting review
          </span>
        )}
      </div>
      <h2 className="mt-4 font-display text-[clamp(1.8rem,3vw,2.6rem)] leading-[0.92] [overflow-wrap:anywhere]" style={{ fontVariationSettings: ax(85, 840) }}>
        {item.campaign.title}
      </h2>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-black/65">
        <div>
          <dt className="inline">Submitted </dt>
          <dd className="inline font-medium text-black/80">
            <Pieces text={`${formatDateShort(submitted)} · ${formatRelative(submitted, now)}`} />
          </dd>
        </div>
        <div>
          <dt className="inline">{ended ? "Deadline passed " : "Closes "}</dt>
          <dd className="inline font-medium text-black/80">
            <Pieces text={`${formatDateShort(deadline)} · ${formatRelative(deadline, now)}`} />
          </dd>
        </div>
      </dl>

      {/* The post itself is never embedded or fetched here; this card only names where it lives. */}
      <div className="mt-6 rounded-[22px] bg-white p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="size-10 shrink-0 rounded-full bg-[conic-gradient(from_200deg,#fdda24,#111,#f2f0e9,#fdda24)]" />
          <div className="min-w-0 leading-tight">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-black/60">The post</p>
            <p className="truncate text-[15px] font-bold">{post ? `@${post.handle}` : "Link on X"}</p>
          </div>
          <span aria-hidden="true" className="ml-auto text-xl font-black">
            X
          </span>
        </div>
        <p className="mt-4 break-all font-mono text-[12px] leading-relaxed text-black/65">{item.workUrl}</p>
        <a
          href={item.workUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-6 text-[14.5px] font-semibold text-white transition-transform duration-150 hover:scale-[1.01] active:scale-[0.98] sm:w-auto"
        >
          Open post on X <span aria-hidden="true">↗</span>
          <span aria-hidden="true" className="[@media(hover:none)]:hidden">
            <kbd className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-white/25 px-1 font-mono text-[11px] text-white/70">O</kbd>
          </span>
        </a>
        <p className="mt-3 text-[12.5px] text-black/65">Read it on X against the brief below. The post is never embedded here.</p>
      </div>

      {item.priorDecision ? (
        <div className="mt-4 rounded-[20px] border border-black/15 p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-black/60">First decision</span>
            <span
              className={cx(
                "rounded-md border-2 px-2 py-0.5 font-mono text-[11px] font-bold tracking-[0.1em]",
                item.priorDecision.outcome === "PASS" ? "border-black bg-accent" : "border-[#b42318] text-[#b42318]",
              )}
            >
              {item.priorDecision.outcome}
            </span>
            <span className="font-mono text-[12px] text-black/60">{reasonLabel(item.priorDecision.reasonCode)}</span>
          </div>
          <p className="mt-2 text-[15px]">{item.priorDecision.note}</p>
          <p className="mt-2 text-[12.5px] text-black/65">The contributor asked for the one re-review. Score it fresh; both decisions stay on-chain.</p>
        </div>
      ) : null}

      {item.sharedFundingCount === null ? (
        <p className="mt-4 text-[13px] text-black/65">Funding source not checked.</p>
      ) : item.sharedFundingCount > 0 ? (
        <p role="note" className="mt-4 rounded-[20px] bg-black p-4 text-[13.5px] leading-relaxed text-white/75">
          <strong className="text-accent">Shared funding source:</strong>{" "}
          {`${item.sharedFundingCount} other ${item.sharedFundingCount === 1 ? "submission" : "submissions"} in this campaign.`} The wallets were
          first funded by the same account, or one funded the other. Weigh it under the single-account check; no signal has been changed.
        </p>
      ) : null}

      <details open className="group mt-6 border-t border-black/15 pt-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-black/65 md:min-h-0 [&::-webkit-details-marker]:hidden">
          Campaign brief
          <span aria-hidden="true" className="text-base transition-transform duration-200 group-open:rotate-45">
            +
          </span>
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-[16px] leading-[1.6] [overflow-wrap:anywhere]">{item.campaign.brief}</p>
      </details>
    </section>
  );
}

/**
 * The yes count against the pass line: one cell per signal, in rubric order,
 * filled for yes and red for no, so the meter shows which signals failed and
 * not only how many; a marker after the fourth, and the outcome stamped beside it.
 */
function ScoreMeter({ signals, passCount, outcome }: { signals: Draft["signals"]; passCount: number; outcome: "PASS" | "FAIL" }) {
  const pass = outcome === "PASS";
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Yeses</h3>
          <p className="mt-2 font-display text-[clamp(4.5rem,8vw,6rem)] leading-[0.78] tabular-nums" style={{ fontVariationSettings: ax(62, 900) }}>
            <span className={pass ? "text-accent" : "text-text"}>{passCount}</span>
            <span className="text-white/25">{` / ${SIGNALS.length}`}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 pb-1">
          <span className="text-[12px] text-white/60">{`${PASS_THRESHOLD} of ${SIGNALS.length} needed to pass`}</span>
          <span
            key={outcome}
            className={cx(
              "inline-block -rotate-6 animate-pop rounded-lg border-[3px] px-3 py-0.5 font-display text-[28px] leading-tight",
              pass ? "border-black bg-accent text-black" : "border-fail text-fail",
            )}
            style={{ fontVariationSettings: ax(70, 900) }}
          >
            {outcome}
          </span>
        </div>
        {/* The one announcement per change; the figure and stamp above are read in place, not announced. */}
        <span className="sr-only" aria-live="polite">{`${passCount} of ${SIGNALS.length} signals pass. Outcome ${outcome}.`}</span>
      </div>
      <div aria-hidden="true" className="relative mt-5 grid grid-cols-6 gap-1.5">
        {SIGNALS.map((s) => (
          <span
            key={s.id}
            className={cx("h-3 rounded-full transition-colors duration-300", signals[s.id] ? (pass ? "bg-accent" : "bg-paper") : "bg-fail/80")}
          />
        ))}
        {/* The pass line sits after the PASS_THRESHOLD-th cell. */}
        <span
          className="absolute -bottom-1.5 -top-1.5 w-[2px] rounded-full bg-white/70"
          style={{ left: `calc(${(PASS_THRESHOLD / SIGNALS.length) * 100}% - 4px)` }}
        />
      </div>
      <p aria-hidden="true" className="relative mt-2 h-4 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
        <span className="absolute -translate-x-1/2" style={{ left: `calc(${(PASS_THRESHOLD / SIGNALS.length) * 100}% - 3px)` }}>
          pass line
        </span>
      </p>
    </div>
  );
}

function SignalRow({
  name,
  index,
  label,
  question,
  value,
  focused,
  disabled,
  onChange,
  onFocus,
}: {
  name: string;
  index: number;
  label: string;
  question: string;
  value: boolean;
  focused: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  onFocus: () => void;
}) {
  const labelId = useId();
  const questionId = useId();
  // A grid, so on a phone the question runs full width under the label and the Yes/No switch instead of squeezing beside it.
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${labelId} ${questionId}`}
      onFocus={onFocus}
      className={cx(
        "grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[20px] border py-2.5 pl-3 pr-2.5 transition-colors duration-200",
        value ? (focused ? "border-white/20 bg-white/[0.04]" : "border-white/[0.06] bg-white/[0.02]") : "border-fail-line bg-fail-soft",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("text-center font-display text-[26px] leading-none sm:row-span-2", value ? "text-white/35" : "text-fail/70")}
        style={{ fontVariationSettings: ax(70, 900) }}
      >
        {index}
      </span>
      <span id={labelId} className={cx("min-w-0 text-[15px] font-semibold leading-tight sm:self-end", value ? "text-text" : "text-fail")}>
        {label}
      </span>
      <span className="inline-flex shrink-0 rounded-full bg-black p-1 sm:row-span-2">
        <Option name={name} checked={value} tone="pass" disabled={disabled} onSelect={() => onChange(true)}>
          Yes
        </Option>
        <Option name={name} checked={!value} tone="fail" disabled={disabled} onSelect={() => onChange(false)}>
          No
        </Option>
      </span>
      <span id={questionId} className="col-span-2 col-start-2 min-w-0 text-[12.5px] leading-snug text-white/60 first-letter:uppercase sm:col-span-1 sm:-mt-1 sm:self-start">
        {question}
      </span>
    </div>
  );
}

function Option({ name, checked, tone, disabled, onSelect, children }: { name: string; checked: boolean; tone: "pass" | "fail"; disabled: boolean; onSelect: () => void; children: string }) {
  return (
    <label
      className={cx(
        "relative inline-flex h-11 min-w-[3rem] cursor-pointer items-center justify-center rounded-full px-3 font-mono sm:min-w-[3.75rem] sm:px-4 text-[12px] font-bold uppercase tracking-[0.1em] transition-[background-color,color,transform] duration-200 active:scale-95",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        checked ? (tone === "pass" ? "bg-paper text-paper-ink" : "bg-fail text-black") : "text-white/60 hover:text-text",
      )}
    >
      <input type="radio" name={name} value={tone} checked={checked} disabled={disabled} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

function RubricGuide({ id }: { id: SignalId }) {
  const index = SIGNALS.findIndex((s) => s.id === id);
  const s = SIGNALS[index] ?? SIGNALS[0];
  return (
    <div className="mt-5 rounded-[22px] bg-white/[0.03] p-5">
      <h3 className="flex items-baseline gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">
        <span className="text-accent">{`Signal ${Math.max(index, 0) + 1}`}</span>
        <span>{`· ${s.label}`}</span>
      </h3>
      {/* The question is quoted verbatim from the README rubric, where it continues a sentence; only its first letter is raised here. */}
      <p className="mt-2.5 text-[15px] font-medium text-text first-letter:uppercase">{s.question}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
        <span className="font-semibold text-fail">Counts as no: </span>
        {s.failsWhen}
      </p>
      {s.v2Guidance ? (
        <p className="mt-2 text-[13.5px] leading-relaxed text-white/60">
          <span className="font-semibold text-text">{`Rubric ${RUBRIC_VERSION}: `}</span>
          {s.v2Guidance}
        </p>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-white/15 bg-white/[0.04] px-1 font-mono text-[11px] font-medium text-white/60">
      {children}
    </kbd>
  );
}
