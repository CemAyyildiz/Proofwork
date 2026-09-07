import { z } from "zod";

/**
 * The six-signal rubric (SOW Deliverable 2). Each signal is a yes/no answer
 * to "does this submission pass this check". Pass gate: majority (>= 4 of 6),
 * per PRD §5. The funder's final approval remains the stricter human check.
 */
export const SIGNALS = [
  { id: "account_genuine", label: "Account genuine", failCode: "R01_ACCOUNT" },
  { id: "content_original", label: "Content original", failCode: "R02_ORIGINAL" },
  { id: "task_done", label: "Task actually done", failCode: "R03_TASK" },
  { id: "follows_brief", label: "Follows the brief", failCode: "R04_BRIEF" },
  { id: "single_account", label: "Single-account check", failCode: "R05_MULTI" },
  { id: "not_spam", label: "Not spam / farming", failCode: "R06_SPAM" },
] as const;

export type SignalId = (typeof SIGNALS)[number]["id"];
export type ReasonCode = "R00_PASS" | (typeof SIGNALS)[number]["failCode"];
export type Outcome = "PASS" | "FAIL";

export const PASS_THRESHOLD = 4;

export const signalsSchema = z.object(
  Object.fromEntries(SIGNALS.map((s) => [s.id, z.boolean()])) as Record<SignalId, z.ZodBoolean>,
);
export type Signals = z.infer<typeof signalsSchema>;

export const reasonCodeSchema = z.enum([
  "R00_PASS",
  "R01_ACCOUNT",
  "R02_ORIGINAL",
  "R03_TASK",
  "R04_BRIEF",
  "R05_MULTI",
  "R06_SPAM",
]);

export function evaluate(signals: Signals): { outcome: Outcome; passCount: number; failed: SignalId[] } {
  const failed = SIGNALS.filter((s) => !signals[s.id]).map((s) => s.id);
  const passCount = SIGNALS.length - failed.length;
  return { outcome: passCount >= PASS_THRESHOLD ? "PASS" : "FAIL", passCount, failed };
}

/**
 * The reason code must be consistent with the signals: PASS => R00_PASS,
 * FAIL => the code of one of the failed signals (the reviewer picks the
 * primary reason). Anything else is a validation error, not a judgement call.
 */
export function validateReason(signals: Signals, reason: ReasonCode): { ok: true } | { ok: false; message: string } {
  const { outcome, failed } = evaluate(signals);
  if (outcome === "PASS") {
    return reason === "R00_PASS" ? { ok: true } : { ok: false, message: "a passing decision must use R00_PASS" };
  }
  const allowed = SIGNALS.filter((s) => failed.includes(s.id)).map((s) => s.failCode as ReasonCode);
  return allowed.includes(reason)
    ? { ok: true }
    : { ok: false, message: `reason must be one of the failed signals: ${allowed.join(", ")}` };
}
