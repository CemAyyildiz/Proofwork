import { createHash } from "node:crypto";
import type { Outcome, ReasonCode, Signals } from "@/domain/rubric";

/**
 * Canonical decision record. This exact JSON is what gets hashed into the
 * on-chain memo, so field order and formatting are fixed here and nowhere else.
 * Anyone can recompute the hash from the stored `canonical_json` and compare
 * it with the transaction memo in an explorer.
 */
export interface DecisionRecord {
  v: 1;
  submission: string; // submission short id
  campaign: string; // campaign slug
  reviewer: string; // reviewer public key
  outcome: Outcome;
  reason: ReasonCode;
  signals: Signals;
  appealOf: string | null; // prior decision hash, if this is a re-review
  decidedAt: string; // ISO-8601 UTC
}

const KEY_ORDER: Array<keyof DecisionRecord> = [
  "v",
  "submission",
  "campaign",
  "reviewer",
  "outcome",
  "reason",
  "signals",
  "appealOf",
  "decidedAt",
];

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
  const ordered = Object.fromEntries(KEY_ORDER.map((k) => [k, k === "signals" ? signals : record[k]]));
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

/** manage_data value: <= 64 bytes. Human-readable outcome + reason + hash prefix. */
export function ledgerValue(record: DecisionRecord): Buffer {
  const prefix = decisionHash(record).subarray(0, 8).toString("hex");
  const value = `v1|${record.outcome}|${record.reason}|${prefix}`;
  const buf = Buffer.from(value, "utf8");
  if (buf.byteLength > 64) throw new Error("ledger value exceeds 64 bytes");
  return buf;
}
