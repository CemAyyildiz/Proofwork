import { z } from "zod";

/**
 * The six-signal rubric (SOW Deliverable 2). Each signal is a yes/no answer
 * to "does this submission pass this check". Pass gate: majority (>= 4 of 6),
 * per PRD §5. The funder's final approval remains the stricter human check.
 *
 * `question` and `failsWhen` are the reviewer's guide. They are copied verbatim
 * from docs/rubric.md (the question line, and the "Counts as fail" cell without
 * its example); tests/unit/rubric.test.ts fails when the two drift apart.
 */
export const SIGNALS = [
  {
    id: "account_genuine",
    label: "Account genuine",
    failCode: "R01_ACCOUNT",
    question: "is this a real, established account rather than a throwaway?",
    failsWhen: "Created just before or during the campaign, no post history, default avatar or throwaway handle pattern.",
  },
  {
    id: "content_original",
    label: "Content original",
    failCode: "R02_ORIGINAL",
    question: "did this person write this themselves?",
    failsWhen: "Near-duplicate of another submission, or visibly pasted template text.",
  },
  {
    id: "task_done",
    label: "Task actually done",
    failCode: "R03_TASK",
    question: "does the post show the person really used the product?",
    failsWhen: "No specifics; could have been written without trying the product.",
  },
  {
    id: "follows_brief",
    label: "Follows the brief",
    failCode: "R04_BRIEF",
    question: "does the post contain everything the campaign brief asked for?",
    failsWhen: "A required element is missing: no product mention, wrong link or wrong format.",
  },
  {
    id: "single_account",
    label: "Single-account check",
    failCode: "R05_MULTI",
    question: "is this one person submitting once, not one person behind several accounts?",
    failsWhen: "Writing style, timing pattern or wallet funding source links it to another submission.",
  },
  {
    id: "not_spam",
    label: "Not spam / farming",
    failCode: "R06_SPAM",
    question: "is this a genuine contribution rather than reward farming?",
    failsWhen: "Generic praise with no detail, or phrasing that matches known farming patterns.",
  },
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

/** What each reason code means, for reviewers and funders. The code itself is what goes on-chain. */
export const REASON_LABELS: Record<ReasonCode, string> = {
  R00_PASS: "Pass",
  R01_ACCOUNT: "Account not genuine",
  R02_ORIGINAL: "Content not original",
  R03_TASK: "Task not done",
  R04_BRIEF: "Brief not followed",
  R05_MULTI: "Linked to another submission",
  R06_SPAM: "Spam or farming",
};

/** "R03_TASK · Task not done"; an unknown code is returned as it is. */
export function reasonLabel(code: string): string {
  const label = (REASON_LABELS as Record<string, string | undefined>)[code];
  return label ? `${code} · ${label}` : code;
}

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
