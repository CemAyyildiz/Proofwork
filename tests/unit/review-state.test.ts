import { describe, expect, it } from "vitest";
import {
  commitErrorMessage,
  commitState,
  draftFor,
  emptyDraft,
  keyAction,
  leavesQueue,
  nextAfter,
  queueCounts,
  ReviewClock,
  shortcutAllowed,
  signalForKey,
  stepFrom,
  withSignal,
  type Draft,
  type KeyInput,
  type ReviewItem,
} from "@/components/review-state";
import { SIGNALS } from "@/domain/rubric";

const item = (id: string): ReviewItem => ({
  submissionId: id,
  shortId: id,
  workUrl: `https://x.com/a/status/${id}`,
  submittedAt: "2026-10-12T10:00:00.000Z",
  status: "pending",
  campaign: { id: "c1", slug: "c1", title: "Title", brief: "brief", deadlineAt: "2026-10-20T18:00:00.000Z" },
  priorDecision: null,
  sharedFundingCount: 0,
});

const key = (k: string, more: Partial<KeyInput> = {}): KeyInput => ({ key: k, repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: { tagName: "BODY" }, ...more });

/** Three signals failed: a FAIL draft. */
const failing = (): Draft => withSignal(withSignal(withSignal(emptyDraft(), "task_done", false), "not_spam", false), "content_original", false);

describe("review queue navigation", () => {
  it("steps through the queue and wraps at both ends", () => {
    const ids = ["a", "b", "c"];
    expect(stepFrom(ids, "a", 1)).toBe("b");
    expect(stepFrom(ids, "c", 1)).toBe("a");
    expect(stepFrom(ids, "a", -1)).toBe("c");
    expect(stepFrom(ids, "gone", 1)).toBe("a");
    expect(stepFrom([], "a", 1)).toBeNull();
  });

  it("moves on to the item that followed the one that left", () => {
    expect(nextAfter(["a", "b", "c"], "a")).toBe("b");
    expect(nextAfter(["a", "b", "c"], "b")).toBe("c");
    expect(nextAfter(["a", "b", "c"], "c")).toBe("a");
    expect(nextAfter(["a"], "a")).toBeNull();
  });

  it("reads N of M · K waiting, without counting an item someone else decided", () => {
    const items = ["a", "b", "c", "d"].map(item);
    expect(queueCounts(items, new Set(), new Set(), "a")).toEqual({ position: 1, total: 4, waiting: 3 });
    expect(queueCounts(items, new Set(["a"]), new Set(), "b")).toEqual({ position: 2, total: 4, waiting: 2 });
    // Skipped to the last open item.
    expect(queueCounts(items, new Set(["a"]), new Set(), "d")).toEqual({ position: 4, total: 4, waiting: 2 });
    // "b" was decided elsewhere (409) and left the queue.
    expect(queueCounts(items, new Set(["a"]), new Set(["b"]), "c")).toEqual({ position: 2, total: 3, waiting: 1 });
    expect(queueCounts(items, new Set(["a", "c", "d"]), new Set(["b"]), null)).toEqual({ position: 0, total: 3, waiting: 0 });
  });
});

describe("drafts", () => {
  it("Skip then Previous shows the same signals, reason and note", () => {
    const ids = ["a", "b", "c"];
    const edited: Draft = { ...failing(), reason: "R03_TASK", note: "Reads like a template." };
    let drafts: ReadonlyMap<string, Draft> = new Map([["a", edited]]);
    const skipped = stepFrom(ids, "a", 1);
    expect(skipped).toBe("b");
    expect(draftFor(drafts, "b")).toEqual(emptyDraft());
    drafts = new Map(drafts).set("b", { ...emptyDraft(), note: "other" });
    const back = stepFrom(ids, skipped, -1);
    expect(back).toBe("a");
    expect(draftFor(drafts, "a")).toEqual(edited);
    expect(commitState(draftFor(drafts, "a"))).toMatchObject({ outcome: "FAIL", reasonCode: "R03_TASK", blocker: null });
  });

  it("starts every signal on pass, and changing an answer clears the reason", () => {
    expect(Object.values(emptyDraft().signals)).toEqual(SIGNALS.map(() => true));
    const picked: Draft = { ...failing(), reason: "R02_ORIGINAL" };
    expect(withSignal(picked, "follows_brief", false).reason).toBe("");
    // Re-setting the same answer only moves the guide.
    expect(withSignal(picked, "task_done", false)).toEqual({ ...picked, guide: "task_done" });
  });
});

describe("record rule", () => {
  it("is ready only with a note of at least 3 characters and a reason set", () => {
    expect(commitState({ ...emptyDraft(), note: "ok, real task" })).toMatchObject({ outcome: "PASS", reasonCode: "R00_PASS", blocker: null });
    expect(commitState({ ...emptyDraft(), note: " ok " }).blocker).toMatch(/note/);
    expect(commitState({ ...failing(), note: "Reads like a template." }).blocker).toBe("Pick a primary reason to record.");
    expect(commitState(failing()).blocker).toBe("Pick a primary reason and write a note to record.");
    expect(commitState({ ...failing(), reason: "R03_TASK", note: "Tell us one thing you tried." }).blocker).toBeNull();
  });

  it("never records a reason that is not one of the failed signals", () => {
    const stale: Draft = { ...failing(), reason: "R01_ACCOUNT", note: "Reads like a template." };
    expect(commitState(stale)).toMatchObject({ reasonCode: "", blocker: "Pick a primary reason to record." });
    expect(commitState(failing()).failedCodes).toEqual(["R02_ORIGINAL", "R03_TASK", "R06_SPAM"]);
  });
});

describe("review keyboard", () => {
  it("maps 1–6 to the rubric rows in order and nothing else", () => {
    expect(["1", "2", "3", "4", "5", "6"].map(signalForKey)).toEqual(SIGNALS.map((s) => s.id));
    expect(signalForKey("7")).toBeNull();
    expect(signalForKey("0")).toBeNull();
    expect(signalForKey("o")).toBeNull();
  });

  it("leaves keys to the note and selects but not to a focused rubric radio", () => {
    expect(shortcutAllowed({ tagName: "TEXTAREA" })).toBe(false);
    expect(shortcutAllowed({ tagName: "SELECT" })).toBe(false);
    expect(shortcutAllowed({ tagName: "INPUT", type: "text" })).toBe(false);
    expect(shortcutAllowed({ tagName: "DIV", isContentEditable: true })).toBe(false);
    expect(shortcutAllowed({ tagName: "INPUT", type: "radio" })).toBe(true);
    expect(shortcutAllowed({ tagName: "BODY" })).toBe(true);
    expect(shortcutAllowed(null)).toBe(true);
  });

  it("a held key acts once: repeats of 2 and of ⌘↵ do nothing", () => {
    expect(keyAction(key("2"))).toEqual({ kind: "toggle", signal: "content_original" });
    expect(keyAction(key("2", { repeat: true }))).toBeNull();
    expect(keyAction(key("Enter", { metaKey: true }))).toEqual({ kind: "record" });
    expect(keyAction(key("Enter", { metaKey: true, repeat: true }))).toBeNull();
    expect(keyAction(key("o", { repeat: true }))).toBeNull();
  });

  it("records with ⌘ or Ctrl + ↵ from the note, and types single keys there", () => {
    const note = { tagName: "TEXTAREA" };
    expect(keyAction(key("Enter", { ctrlKey: true, target: note }))).toEqual({ kind: "record" });
    expect(keyAction(key("Enter", { target: note }))).toBeNull();
    expect(keyAction(key("3", { target: note }))).toBeNull();
    expect(keyAction(key("o", { target: { tagName: "INPUT", type: "text" } }))).toBeNull();
    expect(keyAction(key("O"))).toEqual({ kind: "open" });
    expect(keyAction(key("2", { altKey: true }))).toBeNull();
  });
});

describe("commit errors", () => {
  it("names Stellar only when the server or network failed", () => {
    expect(commitErrorMessage(502, "decision commit failed: tx_bad_seq")).toBe("Couldn't write to Stellar. Try again.");
    expect(commitErrorMessage(0, null)).toBe("Couldn't write to Stellar. Try again.");
    expect(commitErrorMessage(429, "too many requests")).toBe("Too many decisions in a short time. Wait a minute.");
    expect(commitErrorMessage(400, "reason must be one of the failed signals: R03_TASK")).toBe("reason must be one of the failed signals: R03_TASK");
  });

  it("a 409 takes the item out of the queue with a notice; nothing else does", () => {
    expect(leavesQueue(409)).toBe(true);
    for (const status of [0, 400, 403, 404, 429, 500, 502]) expect(leavesQueue(status)).toBe(false);
    expect(commitErrorMessage(409, "submission is decided, not reviewable")).toMatch(/^Already decided by another reviewer/);
    expect(commitErrorMessage(409, "submission already decided")).toMatch(/^Already decided by another reviewer/);
    expect(commitErrorMessage(409, "campaign is closed")).toMatch(/^This campaign is closed/);
  });
});

describe("review clock", () => {
  it("counts only the time an item is on screen", () => {
    const clock = new ReviewClock();
    clock.resume(0);
    clock.lap("task_done", 4_000);
    clock.pause(10_000);
    // Skipped for a minute, then back.
    clock.resume(70_000);
    clock.lap("not_spam", 73_000);
    expect(clock.totalSeconds(75_000)).toBe(15);
    expect(clock.perSignal).toEqual({ task_done: 4, not_spam: 3 });
  });
});
