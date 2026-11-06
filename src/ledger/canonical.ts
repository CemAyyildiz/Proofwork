import { createHash } from "node:crypto";
import type { Outcome, ReasonCode, RubricVersion, Signals } from "@/domain/rubric";

/**
 * Canonical decision record. This exact JSON is what gets hashed into the
 * on-chain memo, so field order and formatting are fixed here and nowhere else.
 * Anyone can recompute the hash from the stored `canonical_json` and compare
 * it with the transaction memo in an explorer.
 *
 * Two shapes exist. `v: 1` records were scored under rubric v1 and are stored
 * and verified exactly as they were written. `v: 2` records add
 * `rubric: "v2"` right after `v`; every new decision is written this way.
 */
interface DecisionFields {
  submission: string; // submission short id
  campaign: string; // campaign slug
  reviewer: string; // reviewer public key
  outcome: Outcome;
  reason: ReasonCode;
  signals: Signals;
  appealOf: string | null; // prior decision hash, if this is a re-review
  decidedAt: string; // ISO-8601 UTC
}

export type DecisionRecordV1 = { v: 1 } & DecisionFields;
export type DecisionRecordV2 = { v: 2; rubric: "v2" } & DecisionFields;
export type DecisionRecord = DecisionRecordV1 | DecisionRecordV2;

const FIELD_ORDER: Array<keyof DecisionFields> = [
  "submission",
  "campaign",
  "reviewer",
  "outcome",
  "reason",
  "signals",
  "appealOf",
  "decidedAt",
];

const KEY_ORDER_V1: string[] = ["v", ...FIELD_ORDER];
const KEY_ORDER_V2: string[] = ["v", "rubric", ...FIELD_ORDER];

const SIGNAL_ORDER: Array<keyof Signals> = [
  "account_genuine",
  "content_original",
  "task_done",
  "follows_brief",
  "single_account",
  "not_spam",
];

export function canonicalJson(record: DecisionRecord): string {
  const signals = Object.fromEntries(SIGNAL_ORDER.map((k) => [k, record.signals[k]]));
  const fields: Record<string, unknown> = { ...record };
  const order = record.v === 2 ? KEY_ORDER_V2 : KEY_ORDER_V1;
  const ordered = Object.fromEntries(order.map((k) => [k, k === "signals" ? signals : fields[k]]));
  return JSON.stringify(ordered);
}

export function decisionHash(record: DecisionRecord): Buffer {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest();
}

/** manage_data key: <= 64 bytes. `pw:<shortId>` for first pass, `pw:<shortId>:a1` for the appeal. */
export function ledgerKey(submissionShortId: string, appeal: boolean): string {
  const key = `pw:${submissionShortId}${appeal ? ":a1" : ""}`;
  if (Buffer.byteLength(key) > 64) throw new Error("ledger key exceeds 64 bytes");
  return key;
}

/**
 * manage_data value: <= 64 bytes. Record version + outcome + reason + hash prefix.
 * The leading `v1` / `v2` is the record version, which is also the rubric the
 * decision was scored under.
 */
export function ledgerValue(record: DecisionRecord): Buffer {
  const prefix = decisionHash(record).subarray(0, 8).toString("hex");
  const value = `v${record.v}|${record.outcome}|${record.reason}|${prefix}`;
  const buf = Buffer.from(value, "utf8");
  if (buf.byteLength > 64) throw new Error("ledger value exceeds 64 bytes");
  return buf;
}

/**
 * Rubric version of a stored canonical record: `v1` for a `v: 1` record,
 * `v2` for a `v: 2` record carrying `rubric: "v2"`. Anything else, including
 * text that is not JSON, is `null`: the caller shows the version as unknown.
 */
export function rubricVersionOf(json: string): RubricVersion | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null; // not a record this app wrote; reported as unknown, not thrown
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const r = parsed as { v?: unknown; rubric?: unknown };
  if (r.v === 1 && r.rubric === undefined) return "v1";
  if (r.v === 2 && r.rubric === "v2") return "v2";
  return null;
}

/**
 * The manage_data value a stored decision carries, rebuilt for display from
 * what the database holds. Its prefix is the record's version; a record whose
 * version cannot be read is shown with `v1`, the only format before v2.
 */
export function storedLedgerValue(d: { canonicalJson: string; outcome: Outcome; reasonCode: string; decisionHash: string }): string {
  return `${rubricVersionOf(d.canonicalJson) ?? "v1"}|${d.outcome}|${d.reasonCode}|${d.decisionHash.slice(0, 16)}`;
}
