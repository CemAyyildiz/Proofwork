import { evaluate, SIGNALS, type Outcome, type ReasonCode, type SignalId, type Signals } from "@/domain/rubric";

/** A queue item as the review page hands it to the browser: dates as ISO strings. */
export interface ReviewItem {
  submissionId: string;
  shortId: string;
  workUrl: string;
  submittedAt: string;
  status: string;
  campaign: { id: string; slug: string; title: string; brief: string; deadlineAt: string };
  priorDecision: { outcome: string; reasonCode: string; note: string } | null;
  /** Other submissions in the campaign linked by funding source; null = not checked. */
  sharedFundingCount: number | null;
}

/** What a recorded decision leaves behind. `txHash` null: stored without an on-chain reference to show. */
export interface Receipt {
  submissionId: string;
  shortId: string;
  campaignId: string;
  outcome: Outcome;
  reasonCode: string;
  decisionId: string;
  txHash: string | null;
}

/** The note rule the server enforces (`decideSchema`): at least this many characters after trimming. */
export const NOTE_MIN = 3;

/** Seconds the server accepts for one review (`decideSchema.secondsTotal`). */
const MAX_REVIEW_SECONDS = 24 * 3600;

/** One submission's unrecorded answers. Kept per submission by the queue, so Skip and Previous lose nothing. */
export interface Draft {
  signals: Signals;
  reason: ReasonCode | "";
  note: string;
  /** The signal whose "fails when" text the guide shows. */
  guide: SignalId;
}

/** Every signal starts passing on every card. A funding warning informs the reviewer and never presets an answer. */
export function emptyDraft(): Draft {
  return {
    signals: Object.fromEntries(SIGNALS.map((s) => [s.id, true])) as Signals,
    reason: "",
    note: "",
    guide: SIGNALS[0].id,
  };
}

export function draftFor(drafts: ReadonlyMap<string, Draft>, submissionId: string): Draft {
  return drafts.get(submissionId) ?? emptyDraft();
}

/** Sets one signal and points the guide at it. Changing an answer clears the chosen reason: the failed set moved. */
export function withSignal(draft: Draft, id: SignalId, value: boolean): Draft {
  if (draft.signals[id] === value) return { ...draft, guide: id };
  return { ...draft, signals: { ...draft.signals, [id]: value }, reason: "", guide: id };
}

export interface CommitState {
  outcome: Outcome;
  passCount: number;
  /** Reason codes the reviewer may pick: the failed signals' codes. Empty on PASS. */
  failedCodes: ReasonCode[];
  /** What is recorded: R00_PASS on PASS, the picked failed-signal code on FAIL, "" while none is picked. */
  reasonCode: ReasonCode | "";
  /** Why the decision cannot be recorded yet; null when it can. */
  blocker: string | null;
}

/**
 * Whether a draft can be recorded, and what would be recorded. The record
 * button and the ⌘/Ctrl + ↵ shortcut both go through this: a decision is sent
 * only with a note of at least NOTE_MIN characters and a reason set.
 */
export function commitState(draft: Draft): CommitState {
  const { outcome, passCount, failed } = evaluate(draft.signals);
  const failedCodes = SIGNALS.filter((s) => failed.includes(s.id)).map((s) => s.failCode as ReasonCode);
  const reasonCode: ReasonCode | "" = outcome === "PASS" ? "R00_PASS" : draft.reason !== "" && failedCodes.includes(draft.reason) ? draft.reason : "";
  const noteShort = draft.note.trim().length < NOTE_MIN;
  const blocker =
    reasonCode === "" && noteShort
      ? "Pick a primary reason and write a note to record."
      : reasonCode === ""
        ? "Pick a primary reason to record."
        : noteShort
          ? `Write a note of at least ${NOTE_MIN} characters to record.`
          : null;
  return { outcome, passCount, failedCodes, reasonCode, blocker };
}

/**
 * The id `delta` steps from `current` in `ids`, wrapping at either end. A
 * current id that is not in the list starts from the first item. Null for an
 * empty list.
 */
export function stepFrom(ids: readonly string[], current: string | null, delta: number): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return ids[0] ?? null;
  const n = ids.length;
  return ids[(((at + delta) % n) + n) % n] ?? null;
}

/**
 * Which item comes after `left` once it leaves the list, together with any
 * ids in `alsoLeaving`: the first one that stays, scanning on from `left` and
 * wrapping. Null when nothing else is open.
 */
export function nextAfter(ids: readonly string[], left: string, alsoLeaving: ReadonlySet<string> = new Set()): string | null {
  const leaving = (id: string) => id === left || alsoLeaving.has(id);
  const at = ids.indexOf(left);
  const n = ids.length;
  for (let step = 1; step <= n; step++) {
    const id = ids[(at + step + n) % n];
    if (id !== undefined && !leaving(id)) return id;
  }
  return null;
}

/**
 * The queue line "N of M · K waiting". M counts what this session was given,
 * less what left because someone else decided it; N is the current item's
 * place after the ones already recorded; K is what is still open besides it.
 * Server order is kept: nothing is re-sorted.
 */
export function queueCounts(
  items: readonly ReviewItem[],
  recorded: ReadonlySet<string>,
  gone: ReadonlySet<string>,
  currentId: string | null,
): { position: number; total: number; waiting: number } {
  const inQueue = items.filter((i) => !gone.has(i.submissionId));
  const open = inQueue.filter((i) => !recorded.has(i.submissionId));
  const at = currentId === null ? -1 : open.findIndex((i) => i.submissionId === currentId);
  return {
    position: at === -1 ? 0 : inQueue.length - open.length + at + 1,
    total: inQueue.length,
    waiting: open.length - (at === -1 ? 0 : 1),
  };
}

/** The signal a number key toggles: "1" is the first rubric row. */
export function signalForKey(key: string): SignalId | null {
  if (!/^[1-9]$/.test(key)) return null;
  return SIGNALS[Number(key) - 1]?.id ?? null;
}

export interface ShortcutTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/**
 * Whether a single-key shortcut (1–6, O) should fire for a keydown on this
 * element. Typing in the note, a text field or a select keeps its keys; a
 * focused rubric radio does not, so the number keys work while tabbing
 * through the rows.
 */
export function shortcutAllowed(target: ShortcutTarget | null): boolean {
  if (!target) return true;
  if (target.isContentEditable) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return false;
  if (tag === "INPUT") return target.type === "radio" || target.type === "checkbox";
  return true;
}

export type KeyAction = { kind: "record" } | { kind: "toggle"; signal: SignalId } | { kind: "open" };

export interface KeyInput {
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: ShortcutTarget | null;
}

/**
 * What a keydown does on the review card, or null. A held key (`repeat`)
 * never acts again: one press, one toggle. ⌘/Ctrl + ↵ records from anywhere,
 * the note included; it is still subject to `commitState`. Single keys are
 * left to text fields and selects.
 */
export function keyAction(e: KeyInput): KeyAction | null {
  if (e.repeat) return null;
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return { kind: "record" };
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (!shortcutAllowed(e.target)) return null;
  const signal = signalForKey(e.key);
  if (signal) return { kind: "toggle", signal };
  if (e.key === "o" || e.key === "O") return { kind: "open" };
  return null;
}

/** What the server answered for a decision, as `record` received it. */
export interface CommitResponse {
  /** HTTP status; 0 when no response arrived. */
  status: number;
  /** The parsed JSON body, or {} when there was none. */
  body: unknown;
}

export type CommitResult =
  | { kind: "recorded"; receipt: Receipt }
  /** The item is no longer this reviewer's to decide. `campaign`: every open item of its campaign leaves with it. */
  | { kind: "left"; scope: "item" | "campaign"; notice: string }
  /** Nothing was recorded; the card stays open with its answers. */
  | { kind: "error"; message: string };

const STELLAR_FAILED = "Couldn't write to Stellar. Try again.";

/** The 409s that mean someone (or an earlier attempt) already decided the item: `decide` refuses it as no longer reviewable. */
function alreadyDecided(message: string | null): boolean {
  return message === "submission already decided" || (message !== null && /^submission is \w+, not reviewable$/.test(message));
}

/**
 * What a decision post did, from the response. `uncertain`: an earlier
 * attempt for this item got no response, so it may have been recorded and a
 * 409 now says so instead of blaming another reviewer.
 */
export function commitResult(res: CommitResponse, item: ReviewItem, reasonCode: ReasonCode, uncertain: boolean): CommitResult {
  const body = typeof res.body === "object" && res.body !== null ? (res.body as Record<string, unknown>) : {};
  const message = typeof body["message"] === "string" ? body["message"] : null;
  const ok = res.status >= 200 && res.status < 300;
  if (ok && typeof body["id"] === "string") {
    const txHash = body["txHash"];
    return {
      kind: "recorded",
      receipt: {
        submissionId: item.submissionId,
        shortId: item.shortId,
        campaignId: item.campaign.id,
        outcome: body["outcome"] === "PASS" ? "PASS" : "FAIL",
        reasonCode: typeof body["reasonCode"] === "string" ? body["reasonCode"] : reasonCode,
        decisionId: body["id"],
        txHash: typeof txHash === "string" && txHash !== "" ? txHash : null,
      },
    };
  }
  if (ok || res.status === 0 || res.status >= 500) return { kind: "error", message: STELLAR_FAILED };
  if (res.status === 409 && message === "campaign is closed") {
    return { kind: "left", scope: "campaign", notice: "This campaign is closed. Its submissions left the queue." };
  }
  if (res.status === 409 && alreadyDecided(message)) {
    return {
      kind: "left",
      scope: "item",
      notice: uncertain ? "Your earlier attempt may have been recorded. Check the review log." : "Already decided by another reviewer. The submission left the queue.",
    };
  }
  if (res.status === 404) return { kind: "left", scope: "item", notice: "This submission no longer exists." };
  if (res.status === 401 || res.status === 403) {
    return { kind: "error", message: "Your session ended or lost the reviewer role. Sign in again; your answers are kept." };
  }
  if (res.status === 429) return { kind: "error", message: "Too many decisions in a short time. Wait a minute." };
  return { kind: "error", message: message ?? `The decision was refused (${res.status}).` };
}

/**
 * Review time for the log, counted only while the item is on screen: time
 * spent on a skipped item does not count against it. Callers pass the clock
 * reading so this stays deterministic.
 */
export class ReviewClock {
  private spentMs = 0;
  private since: number | null = null;
  private lastTick = 0;
  readonly perSignal: Record<string, number> = {};

  resume(now: number): void {
    if (this.since !== null) return;
    this.since = now;
    this.lastTick = now;
  }

  pause(now: number): void {
    if (this.since === null) return;
    this.spentMs += now - this.since;
    this.since = null;
  }

  /** Seconds since the last answer (or since the item came on screen), booked to this signal. */
  lap(id: SignalId, now: number): void {
    if (this.since === null) return;
    // A clock that moved backwards books nothing: the server refuses negative seconds.
    this.perSignal[id] = (this.perSignal[id] ?? 0) + Math.max(0, Math.round((now - this.lastTick) / 1000));
    this.lastTick = now;
  }

  totalSeconds(now: number): number {
    const ms = this.spentMs + (this.since === null ? 0 : now - this.since);
    return Math.min(MAX_REVIEW_SECONDS, Math.max(0, Math.round(ms / 1000)));
  }
}
