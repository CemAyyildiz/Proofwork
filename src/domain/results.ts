import { z } from "zod";
import { SIGNALS, type Outcome, type SignalId } from "@/domain/rubric";
import { canonicalizeSubmissionUrl } from "@/domain/submission-url";
import { parseCsv } from "@/lib/csv";

/**
 * Results scoring (SOW Deliverable 3, Week 4). Joins the exported review log
 * with the planted list, which is kept outside the app and never enters the
 * database (AD-10). Everything here is pure: the CLI in `scripts/results.ts`
 * reads the files and writes `docs/results.md`.
 */

/** PRD §1, printed verbatim in the output. */
export const HONESTY_NOTE =
  "> **Honesty constraint.** One campaign, one reviewer, and a sample in the tens is a *directional first signal, not a validated fraud benchmark*. The PRD must not oversell this number — its job is to tell us whether the rubric is worth building further, not to prove a detection rate.";

/**
 * A signal is "weak" when the share of planted submissions failing it is less
 * than this many percentage points above the share of genuine submissions
 * failing it (compared on the rounded value that is displayed).
 */
export const WEAK_SEPARATION_PP = 20;

export class ResultsInputError extends Error {
  override readonly name = "ResultsInputError";
}

type SignalColumn = `signal_${SignalId}`;

export interface LogRow {
  shortId: string;
  workUrl: string;
  campaign: string;
  isAppeal: boolean;
  decidedAt: string;
  outcome: Outcome;
  signals: Record<SignalId, boolean | null>;
}

export interface PlantedRow {
  /** 1-based data row in the planted file, used instead of any identifying value. */
  row: number;
  shortId: string | null;
  workUrl: string | null;
  planted: boolean;
}

export interface SecondRow {
  row: number;
  shortId: string | null;
  workUrl: string | null;
  outcome: Outcome;
}

// ---------------------------------------------------------------- parsing

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const optionalBool = z.enum(["true", "false", ""]).transform((v) => (v === "" ? null : v === "true"));
const outcome = z.enum(["PASS", "FAIL"]);
const optionalOutcome = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(["PASS", "FAIL", ""]))
  .transform((v): Outcome | null => (v === "" ? null : v));
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? null : v.trim()));

const signalShape = Object.fromEntries(SIGNALS.map((s) => [`signal_${s.id}`, optionalBool])) as Record<SignalColumn, typeof optionalBool>;

const logRowSchema = z.object({
  campaign_slug: z.string().trim().min(1),
  submission_short_id: z.string().trim().min(1),
  work_url: z.string(),
  is_appeal: bool,
  decided_at: z.iso.datetime(),
  outcome,
  ...signalShape,
});

const plantedRowSchema = z
  .object({
    submission_short_id: optionalId,
    work_url: optionalId,
    planted: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["true", "false"]))
      .transform((v) => v === "true"),
  })
  .refine((r) => r.submission_short_id !== null || r.work_url !== null, "needs submission_short_id or work_url");

const secondRowSchema = z.object({
  submission_short_id: optionalId,
  work_url: optionalId,
  outcome: optionalOutcome,
  is_appeal: z.enum(["true", "false", ""]).optional(),
});

function readCsv(label: string, text: string): { header: string[]; rows: Array<Record<string, string>> } {
  try {
    return parseCsv(text);
  } catch (e) {
    throw new ResultsInputError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function requireColumns(label: string, header: string[], required: readonly string[]): void {
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new ResultsInputError(`${label}: missing column ${missing.map((c) => `"${c}"`).join(", ")}`);
}

function parseRow<T>(label: string, schema: z.ZodType<T>, raw: Record<string, string>, row: number): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ResultsInputError(`${label}: data row ${row}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Reads a review log export (CSV from `GET /api/campaigns/[id]/review-log`). */
export function parseReviewLog(text: string, label = "review log"): LogRow[] {
  const { header, rows } = readCsv(label, text);
  requireColumns(label, header, Object.keys(logRowSchema.shape));
  return rows.map((raw, i) => {
    const r = parseRow(label, logRowSchema, raw, i + 1);
    const signals = Object.fromEntries(SIGNALS.map((s) => [s.id, r[`signal_${s.id}`]])) as Record<SignalId, boolean | null>;
    return {
      shortId: r.submission_short_id,
      workUrl: r.work_url,
      campaign: r.campaign_slug,
      isAppeal: r.is_appeal,
      decidedAt: r.decided_at,
      outcome: r.outcome,
      signals,
    };
  });
}

function requireIdColumn(label: string, header: string[]): void {
  if (!header.includes("submission_short_id") && !header.includes("work_url")) {
    throw new ResultsInputError(`${label}: missing column "submission_short_id" or "work_url"`);
  }
}

/** Reads the planted list: `submission_short_id` and/or `work_url`, plus `planted` = true/false. */
export function parsePlanted(text: string, label = "planted list"): PlantedRow[] {
  const { header, rows } = readCsv(label, text);
  requireIdColumn(label, header);
  requireColumns(label, header, ["planted"]);
  return rows.map((raw, i) => {
    const r = parseRow(label, plantedRowSchema, raw, i + 1);
    return { row: i + 1, shortId: r.submission_short_id, workUrl: r.work_url, planted: r.planted };
  });
}

/**
 * Reads a second reviewer's verdicts: an id column and `outcome` (PASS/FAIL).
 * A review log export is accepted too; its appeal and undecided rows are skipped.
 */
export function parseSecond(text: string, label = "second reviewer"): SecondRow[] {
  const { header, rows } = readCsv(label, text);
  requireIdColumn(label, header);
  requireColumns(label, header, ["outcome"]);
  const out: SecondRow[] = [];
  rows.forEach((raw, i) => {
    const r = parseRow(label, secondRowSchema, raw, i + 1);
    if (r.is_appeal === "true" || r.outcome === null) return;
    if (r.submission_short_id === null && r.work_url === null) {
      throw new ResultsInputError(`${label}: data row ${i + 1}: needs submission_short_id or work_url`);
    }
    out.push({ row: i + 1, shortId: r.submission_short_id, workUrl: r.work_url, outcome: r.outcome });
  });
  return out;
}

// ---------------------------------------------------------------- scoring

export type Group = "planted" | "genuine";

export interface Count {
  failed: number;
  total: number;
}

/** separates: >= WEAK_SEPARATION_PP; weak: 0..below it; inverted: fails genuine more than planted. */
export type SignalStatus = "separates" | "weak" | "inverted" | "no data";

export interface SignalResult {
  id: SignalId;
  label: string;
  planted: { falseCount: number; known: number };
  genuine: { falseCount: number; known: number };
  /** Planted fail share minus genuine fail share in percentage points, rounded to 0.1; null without data. */
  separationPp: number | null;
  status: SignalStatus;
}

export interface Metrics {
  campaign: string | null;
  submissionsInLog: number;
  sampleSize: number;
  blind: Record<Group, Count>;
  final: Record<Group, Count>;
  /** planted=true rows matching no submission in the log: planted but never submitted/decided. */
  plantedNotReviewed: number;
  /** planted=false rows matching no submission in the log. */
  genuineListedUnmatched: number;
  /** Genuine submissions that were simply absent from the planted list. */
  genuineUnlisted: number;
  appeals: Record<Group, { appealed: number; overturned: number }>;
  signals: SignalResult[];
  /** For the CLI's stderr only; never rendered into the committed doc. */
  unmatchedPlanted: Array<{ row: number; planted: boolean }>;
  agreement: null | {
    n: number;
    agree: number;
    kappa: number | null;
    unmatched: number;
    duplicates: number;
  };
}

interface Submission {
  shortId: string;
  decisions: LogRow[];
  blind: LogRow;
  final: LogRow;
  appealed: boolean;
}

type Lookup = (id: { shortId: string | null; workUrl: string | null }, label: string) => Submission | null;

function urlKey(url: string): string {
  try {
    return canonicalizeSubmissionUrl(url).url;
  } catch {
    // Not an X status URL: match on the trimmed string as given.
    return url.trim();
  }
}

function buildSubmissions(log: LogRow[]): { subs: Submission[]; lookup: Lookup } {
  const grouped = new Map<string, LogRow[]>();
  for (const r of log) grouped.set(r.shortId, [...(grouped.get(r.shortId) ?? []), r]);

  const byShort = new Map<string, Submission>();
  const byUrl = new Map<string, Submission[]>();
  for (const [shortId, rows] of grouped) {
    // Stable sort on parsed time; keeps export order on ties.
    const decisions = [...rows].sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));
    const blind = decisions.find((d) => !d.isAppeal);
    if (!blind) throw new ResultsInputError(`review log: submission ${shortId} has only appeal decisions`);
    const final = decisions[decisions.length - 1] as LogRow; // non-empty: contains `blind`
    const s: Submission = { shortId, decisions, blind, final, appealed: decisions.some((d) => d.isAppeal) };
    byShort.set(shortId, s);
    for (const key of new Set(rows.map((r) => r.workUrl.trim()).filter((u) => u !== "").map(urlKey))) {
      byUrl.set(key, [...(byUrl.get(key) ?? []), s]);
    }
  }

  const lookup: Lookup = (id, label) => {
    const byS = id.shortId !== null ? byShort.get(id.shortId) : undefined;
    let byU: Submission | undefined;
    if (id.workUrl !== null) {
      const hits = byUrl.get(urlKey(id.workUrl)) ?? [];
      if (hits.length > 1) throw new ResultsInputError(`${label}: work_url matches ${hits.length} submissions in the review log`);
      byU = hits[0];
    }
    if (byS && byU && byS !== byU) throw new ResultsInputError(`${label}: submission_short_id and work_url point to different submissions`);
    return byS ?? byU ?? null;
  };
  return { subs: [...byShort.values()], lookup };
}

function kappa(pairs: Array<[Outcome, Outcome]>): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const aFail = pairs.filter(([a]) => a === "FAIL").length / n;
  const bFail = pairs.filter(([, b]) => b === "FAIL").length / n;
  const pe = aFail * bFail + (1 - aFail) * (1 - bFail);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

function signalStatus(pp: number | null): SignalStatus {
  if (pp === null) return "no data";
  if (pp < 0) return "inverted";
  return pp < WEAK_SEPARATION_PP ? "weak" : "separates";
}

export function score(log: LogRow[], planted: PlantedRow[], second?: SecondRow[]): Metrics {
  const campaigns = [...new Set(log.map((r) => r.campaign))];
  if (campaigns.length > 1) throw new ResultsInputError(`review log: rows from ${campaigns.length} campaigns; score one campaign at a time`);
  const { subs, lookup } = buildSubmissions(log);

  const groupOf = new Map<Submission, Group>();
  const unmatchedPlanted: Metrics["unmatchedPlanted"] = [];
  for (const p of planted) {
    const label = `planted list: data row ${p.row}`;
    const s = lookup(p, label);
    if (!s) {
      unmatchedPlanted.push({ row: p.row, planted: p.planted });
      continue;
    }
    const g: Group = p.planted ? "planted" : "genuine";
    const prev = groupOf.get(s);
    if (prev !== undefined && prev !== g) throw new ResultsInputError(`${label}: submission is listed as both planted and genuine`);
    groupOf.set(s, g);
  }

  const blind: Record<Group, Count> = { planted: { failed: 0, total: 0 }, genuine: { failed: 0, total: 0 } };
  const final: Record<Group, Count> = { planted: { failed: 0, total: 0 }, genuine: { failed: 0, total: 0 } };
  const appeals: Metrics["appeals"] = { planted: { appealed: 0, overturned: 0 }, genuine: { appealed: 0, overturned: 0 } };
  const sig = new Map<SignalId, Record<Group, { falseCount: number; known: number }>>(
    SIGNALS.map((s) => [s.id, { planted: { falseCount: 0, known: 0 }, genuine: { falseCount: 0, known: 0 } }]),
  );
  let genuineUnlisted = 0;

  for (const s of subs) {
    const listed = groupOf.get(s);
    const g: Group = listed ?? "genuine";
    if (listed === undefined) genuineUnlisted += 1;
    blind[g].total += 1;
    if (s.blind.outcome === "FAIL") blind[g].failed += 1;
    final[g].total += 1;
    if (s.final.outcome === "FAIL") final[g].failed += 1;
    if (s.appealed) {
      appeals[g].appealed += 1;
      if (s.final.outcome !== s.blind.outcome) appeals[g].overturned += 1;
    }
    for (const x of SIGNALS) {
      const v = s.blind.signals[x.id];
      if (v === null) continue;
      const bucket = (sig.get(x.id) as Record<Group, { falseCount: number; known: number }>)[g];
      bucket.known += 1;
      if (!v) bucket.falseCount += 1;
    }
  }

  const signals: SignalResult[] = SIGNALS.map((x) => {
    const b = sig.get(x.id) as Record<Group, { falseCount: number; known: number }>;
    const raw = b.planted.known > 0 && b.genuine.known > 0 ? b.planted.falseCount / b.planted.known - b.genuine.falseCount / b.genuine.known : null;
    const separationPp = raw === null ? null : Math.round(raw * 1000) / 10;
    return { id: x.id, label: x.label, planted: b.planted, genuine: b.genuine, separationPp, status: signalStatus(separationPp) };
  });

  let agreement: Metrics["agreement"] = null;
  if (second) {
    const pairs: Array<[Outcome, Outcome]> = [];
    const seen = new Set<Submission>();
    let unmatched = 0;
    let duplicates = 0;
    for (const r of second) {
      const s = lookup(r, `second reviewer: data row ${r.row}`);
      if (!s) {
        unmatched += 1;
      } else if (seen.has(s)) {
        duplicates += 1;
      } else {
        seen.add(s);
        pairs.push([s.blind.outcome, r.outcome]);
      }
    }
    agreement = { n: pairs.length, agree: pairs.filter(([a, b]) => a === b).length, kappa: kappa(pairs), unmatched, duplicates };
  }

  return {
    campaign: campaigns[0] ?? null,
    submissionsInLog: subs.length,
    sampleSize: blind.planted.total + blind.genuine.total,
    blind,
    final,
    plantedNotReviewed: unmatchedPlanted.filter((u) => u.planted).length,
    genuineListedUnmatched: unmatchedPlanted.filter((u) => !u.planted).length,
    genuineUnlisted,
    appeals,
    signals,
    unmatchedPlanted,
    agreement,
  };
}

// ---------------------------------------------------------------- rendering

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

/** "80% (8/10)", or "n/a (0)" when there is nothing to divide by. */
export function rate(num: number, den: number): string {
  return den === 0 ? "n/a (0)" : `${pct(num / den)} (${num}/${den})`;
}

function points(pp: number | null): string {
  if (pp === null) return "n/a";
  return `${pp > 0 ? "+" : ""}${pp} pp`;
}

const STATUS_LABEL: Record<SignalStatus, string> = {
  separates: "no",
  weak: "**weak**",
  inverted: "**inverted**",
  "no data": "**weak** (no data)",
};

/**
 * Aggregate Markdown only. No submission id, URL or key is ever written: a
 * per-submission line next to planted/genuine would publish the plant list.
 */
export function renderResults(m: Metrics): string {
  const L: string[] = [];
  L.push("# Results — rubric catch rate and false-positive rate", "");
  L.push(`Campaign: ${m.campaign ? `\`${m.campaign}\`` : "(none)"}. Generated by \`pnpm results\` from the exported review log joined with the planted list, which is kept outside the app and the repository.`, "");
  L.push(HONESTY_NOTE, "");

  L.push("## Headline (blind verdict)", "");
  L.push("| Metric | Value |", "|---|---|");
  L.push(`| Sample size (submissions with a decision) | ${m.sampleSize} (${m.blind.planted.total} planted, ${m.blind.genuine.total} genuine) |`);
  L.push(`| Catch rate | ${rate(m.blind.planted.failed, m.blind.planted.total)} |`);
  L.push(`| False-positive rate | ${rate(m.blind.genuine.failed, m.blind.genuine.total)} |`);
  L.push(`| Planted passed (missed) | ${m.blind.planted.total - m.blind.planted.failed} |`);
  L.push(`| Genuine passed | ${m.blind.genuine.total - m.blind.genuine.failed} |`);
  L.push(`| Not reviewed (planted but never submitted/decided) | ${m.plantedNotReviewed} |`);
  L.push(`| Listed genuine, no matching submission | ${m.genuineListedUnmatched} |`, "");

  L.push("Definitions:", "");
  L.push("- **Catch rate** = planted FAIL / planted total.");
  L.push("- **False-positive rate** = genuine FAIL / genuine total.");
  L.push("- Both use the reviewer's first (pre-appeal) decision on each submission: the blind verdict. The post-appeal outcome is reported separately below.");
  L.push("- Planted-list rows that match no decided submission in the review log are excluded from every rate; planted ones are counted under \"not reviewed\".");
  L.push(`- A submission is genuine unless the planted list marks it planted (${m.genuineUnlisted} genuine submission(s) were not listed at all).`, "");

  L.push("## After appeals", "");
  L.push("| Metric | Blind verdict | After appeals |", "|---|---|---|");
  L.push(`| Catch rate | ${rate(m.blind.planted.failed, m.blind.planted.total)} | ${rate(m.final.planted.failed, m.final.planted.total)} |`);
  L.push(`| False-positive rate | ${rate(m.blind.genuine.failed, m.blind.genuine.total)} | ${rate(m.final.genuine.failed, m.final.genuine.total)} |`, "");
  L.push("| Group | Appealed | Overturned |", "|---|---|---|");
  L.push(`| Planted | ${m.appeals.planted.appealed} | ${m.appeals.planted.overturned} |`);
  L.push(`| Genuine | ${m.appeals.genuine.appealed} | ${m.appeals.genuine.overturned} |`, "");

  L.push("## Per-signal breakdown (blind verdict)", "");
  L.push("How often each rubric signal was answered \"no\" (failed) on planted versus genuine submissions. Separation = planted fail share minus genuine fail share.", "");
  L.push("| Signal | Failed on planted | Failed on genuine | Separation | Weak |", "|---|---|---|---|---|");
  for (const s of m.signals) {
    L.push(`| ${s.label} | ${rate(s.planted.falseCount, s.planted.known)} | ${rate(s.genuine.falseCount, s.genuine.known)} | ${points(s.separationPp)} | ${STATUS_LABEL[s.status]} |`);
  }
  L.push("");
  L.push(`A signal is **weak** when its separation is below ${WEAK_SEPARATION_PP} percentage points, or when either group has no data: it rarely tells planted and genuine submissions apart. It is **inverted** when the separation is negative: it fails genuine submissions more often than planted ones.`, "");

  if (m.agreement) {
    const a = m.agreement;
    L.push("## Second reviewer agreement", "");
    L.push("| Metric | Value |", "|---|---|");
    L.push(`| Overlap (n) | ${a.n} |`);
    L.push(`| Same outcome | ${rate(a.agree, a.n)} |`);
    L.push(`| Cohen's κ | ${a.kappa === null ? "n/a" : (Math.round(a.kappa * 100) / 100).toFixed(2)} (n=${a.n}) |`);
    L.push(`| Second-reviewer rows not matched to a submission | ${a.unmatched} |`);
    L.push(`| Duplicate second-reviewer rows (ignored) | ${a.duplicates} |`, "");
    L.push("Compared against the first reviewer's blind verdict on the overlapping submissions.", "");
  }

  L.push("## Limits", "");
  L.push("- One campaign and one primary reviewer; the sample is small, so every rate carries wide uncertainty. Counts are shown next to each percentage for that reason.");
  L.push("- The planted submissions were written and submitted by a second person; their style may not match real farming.");
  L.push("- The per-signal breakdown describes this sample only; a \"weak\" label is a prompt to revisit the signal, not a verdict on it.");
  L.push("");
  return L.join("\n");
}
