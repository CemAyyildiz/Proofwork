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
 * than this many points above the share of genuine submissions failing it.
 */
export const WEAK_SEPARATION = 0.2;

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
  outcome: Outcome | null;
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
const optionalOutcome = z.enum(["PASS", "FAIL", ""]).transform((v): Outcome | null => (v === "" ? null : v));
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? null : v.trim()));

const signalShape = Object.fromEntries(SIGNALS.map((s) => [`signal_${s.id}`, optionalBool])) as Record<SignalColumn, typeof optionalBool>;

const logRowSchema = z.object({
  campaign_slug: z.string(),
  submission_short_id: z.string().trim().min(1),
  work_url: z.string(),
  is_appeal: bool,
  decided_at: z.string(),
  outcome: optionalOutcome,
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

export interface SignalResult {
  id: SignalId;
  label: string;
  planted: { falseCount: number; known: number };
  genuine: { falseCount: number; known: number };
  /** Planted false share minus genuine false share; null when either side has no data. */
  separation: number | null;
  weak: boolean;
}

export interface Metrics {
  campaigns: string[];
  submissionsInLog: number;
  sampleSize: number;
  blind: Record<Group, Count>;
  final: Record<Group, Count>;
  notReviewed: Record<Group, number>;
  /** Genuine submissions that were simply absent from the planted list. */
  genuineUnlisted: number;
  appeals: Array<{ shortId: string; group: Group; blind: Outcome; final: Outcome }>;
  signals: SignalResult[];
  unmatchedPlanted: Array<{ row: number; shortId: string | null; planted: boolean }>;
  agreement: null | {
    n: number;
    agree: number;
    kappa: number | null;
    unmatched: number;
  };
}

interface Submission {
  shortId: string;
  decided: LogRow[];
  blind: LogRow | null;
  final: LogRow | null;
}

function urlKey(url: string): string {
  try {
    return canonicalizeSubmissionUrl(url).url;
  } catch {
    // Not an X status URL: match on the trimmed string as given.
    return url.trim();
  }
}

function buildSubmissions(log: LogRow[]): { subs: Submission[]; lookup: (id: { shortId: string | null; workUrl: string | null }) => Submission | null } {
  const byShort = new Map<string, Submission>();
  const byUrl = new Map<string, Submission>();
  for (const r of log) {
    let s = byShort.get(r.shortId);
    if (!s) {
      s = { shortId: r.shortId, decided: [], blind: null, final: null };
      byShort.set(r.shortId, s);
    }
    if (r.workUrl.trim() !== "") byUrl.set(urlKey(r.workUrl), s);
    if (r.outcome !== null) s.decided.push(r);
  }
  for (const s of byShort.values()) {
    // ISO timestamps sort lexically; stable sort keeps export order on ties.
    s.decided.sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0));
    s.blind = s.decided.find((d) => !d.isAppeal) ?? s.decided[0] ?? null;
    s.final = s.decided[s.decided.length - 1] ?? null;
  }
  const lookup = (id: { shortId: string | null; workUrl: string | null }): Submission | null =>
    (id.shortId !== null ? byShort.get(id.shortId) : undefined) ?? (id.workUrl !== null ? byUrl.get(urlKey(id.workUrl)) : undefined) ?? null;
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

export function score(log: LogRow[], planted: PlantedRow[], second?: SecondRow[]): Metrics {
  const { subs, lookup } = buildSubmissions(log);

  const groupOf = new Map<Submission, Group>();
  const unmatchedPlanted: Metrics["unmatchedPlanted"] = [];
  for (const p of planted) {
    const s = lookup(p);
    if (!s) {
      unmatchedPlanted.push({ row: p.row, shortId: p.shortId, planted: p.planted });
      continue;
    }
    const g: Group = p.planted ? "planted" : "genuine";
    const prev = groupOf.get(s);
    if (prev !== undefined && prev !== g) {
      throw new ResultsInputError(`planted list: data row ${p.row}: submission ${s.shortId} is listed as both planted and genuine`);
    }
    groupOf.set(s, g);
  }

  const blind: Record<Group, Count> = { planted: { failed: 0, total: 0 }, genuine: { failed: 0, total: 0 } };
  const final: Record<Group, Count> = { planted: { failed: 0, total: 0 }, genuine: { failed: 0, total: 0 } };
  const notReviewed: Record<Group, number> = { planted: 0, genuine: 0 };
  const appeals: Metrics["appeals"] = [];
  const sig = new Map<SignalId, Record<Group, { falseCount: number; known: number }>>(
    SIGNALS.map((s) => [s.id, { planted: { falseCount: 0, known: 0 }, genuine: { falseCount: 0, known: 0 } }]),
  );
  let genuineUnlisted = 0;

  for (const s of subs) {
    const listed = groupOf.get(s);
    const g: Group = listed ?? "genuine";
    if (!s.blind || !s.final) {
      notReviewed[g] += 1;
      continue;
    }
    if (listed === undefined) genuineUnlisted += 1;
    blind[g].total += 1;
    if (s.blind.outcome === "FAIL") blind[g].failed += 1;
    final[g].total += 1;
    if (s.final.outcome === "FAIL") final[g].failed += 1;
    if (s.decided.length > 1 && s.blind.outcome !== null && s.final.outcome !== null) {
      appeals.push({ shortId: s.shortId, group: g, blind: s.blind.outcome, final: s.final.outcome });
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
    const separation =
      b.planted.known > 0 && b.genuine.known > 0 ? b.planted.falseCount / b.planted.known - b.genuine.falseCount / b.genuine.known : null;
    return { id: x.id, label: x.label, planted: b.planted, genuine: b.genuine, separation, weak: separation === null || separation < WEAK_SEPARATION };
  });

  let agreement: Metrics["agreement"] = null;
  if (second) {
    const pairs: Array<[Outcome, Outcome]> = [];
    const seen = new Set<Submission>();
    let unmatched = 0;
    for (const r of second) {
      const s = lookup(r);
      if (!s || !s.blind || s.blind.outcome === null || seen.has(s)) {
        unmatched += 1;
        continue;
      }
      seen.add(s);
      pairs.push([s.blind.outcome, r.outcome]);
    }
    agreement = { n: pairs.length, agree: pairs.filter(([a, b]) => a === b).length, kappa: kappa(pairs), unmatched };
  }

  return {
    campaigns: [...new Set(log.map((r) => r.campaign).filter((c) => c !== ""))].sort(),
    submissionsInLog: subs.length,
    sampleSize: blind.planted.total + blind.genuine.total,
    blind,
    final,
    notReviewed,
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

function points(sep: number | null): string {
  if (sep === null) return "n/a";
  const pp = Math.round(sep * 1000) / 10;
  return `${pp > 0 ? "+" : ""}${pp} pp`;
}

export function renderResults(m: Metrics): string {
  const L: string[] = [];
  const campaigns = m.campaigns.length > 0 ? m.campaigns.map((c) => `\`${c}\``).join(", ") : "(none)";
  L.push("# Results — rubric catch rate and false-positive rate", "");
  L.push(`Campaign: ${campaigns}. Generated by \`pnpm results\` from the exported review log joined with the planted list, which is kept outside the app and the repository.`, "");
  L.push(HONESTY_NOTE, "");

  L.push("## Headline (blind verdict)", "");
  L.push("| Metric | Value |", "|---|---|");
  L.push(`| Sample size (submissions with a decision) | ${m.sampleSize} (${m.blind.planted.total} planted, ${m.blind.genuine.total} genuine) |`);
  L.push(`| Catch rate | ${rate(m.blind.planted.failed, m.blind.planted.total)} |`);
  L.push(`| False-positive rate | ${rate(m.blind.genuine.failed, m.blind.genuine.total)} |`);
  L.push(`| Planted passed (missed) | ${m.blind.planted.total - m.blind.planted.failed} |`);
  L.push(`| Genuine passed | ${m.blind.genuine.total - m.blind.genuine.failed} |`);
  L.push(`| Not reviewed (no decision) | ${m.notReviewed.planted + m.notReviewed.genuine} (${m.notReviewed.planted} planted, ${m.notReviewed.genuine} genuine) |`, "");

  L.push("Definitions:", "");
  L.push("- **Catch rate** = planted FAIL / planted total.");
  L.push("- **False-positive rate** = genuine FAIL / genuine total.");
  L.push("- Both use the reviewer's first (pre-appeal) decision on each submission: the blind verdict. The post-appeal outcome is reported separately below.");
  L.push("- Submissions with no decision are excluded from every rate and counted under \"not reviewed\".");
  L.push(`- A submission is genuine unless the planted list marks it planted (${m.genuineUnlisted} genuine submission(s) were not listed at all).`, "");

  L.push("## After appeals", "");
  L.push("| Metric | Blind verdict | After appeals |", "|---|---|---|");
  L.push(`| Catch rate | ${rate(m.blind.planted.failed, m.blind.planted.total)} | ${rate(m.final.planted.failed, m.final.planted.total)} |`);
  L.push(`| False-positive rate | ${rate(m.blind.genuine.failed, m.blind.genuine.total)} | ${rate(m.final.genuine.failed, m.final.genuine.total)} |`, "");
  if (m.appeals.length === 0) {
    L.push("No submission was re-reviewed.", "");
  } else {
    L.push("| Submission | Group | Blind verdict | After appeal | Overturned |", "|---|---|---|---|---|");
    for (const a of m.appeals) L.push(`| \`${a.shortId}\` | ${a.group} | ${a.blind} | ${a.final} | ${a.blind !== a.final ? "yes" : "no"} |`);
    L.push("");
  }

  L.push("## Per-signal breakdown (blind verdict)", "");
  L.push("How often each rubric signal was answered \"no\" (failed) on planted versus genuine submissions. Separation = planted fail share minus genuine fail share.", "");
  L.push("| Signal | Failed on planted | Failed on genuine | Separation | Weak |", "|---|---|---|---|---|");
  for (const s of m.signals) {
    L.push(`| ${s.label} | ${rate(s.planted.falseCount, s.planted.known)} | ${rate(s.genuine.falseCount, s.genuine.known)} | ${points(s.separation)} | ${s.weak ? "**weak**" : "no"} |`);
  }
  L.push("");
  L.push(`A signal is **weak** when its separation is below ${WEAK_SEPARATION * 100} percentage points, or when either group has no data: it rarely tells planted and genuine submissions apart.`, "");

  if (m.agreement) {
    const a = m.agreement;
    L.push("## Second reviewer agreement", "");
    L.push("| Metric | Value |", "|---|---|");
    L.push(`| Overlap (n) | ${a.n} |`);
    L.push(`| Same outcome | ${rate(a.agree, a.n)} |`);
    L.push(`| Cohen's κ | ${a.kappa === null ? "n/a" : (Math.round(a.kappa * 100) / 100).toFixed(2)} (n=${a.n}) |`);
    L.push(`| Second-reviewer rows not matched to a decided submission | ${a.unmatched} |`, "");
    L.push("Compared against the first reviewer's blind verdict on the overlapping submissions.", "");
  }

  if (m.unmatchedPlanted.length > 0) {
    L.push("## Warnings", "");
    L.push("Rows in the planted list that match no submission in the review log (planted but never submitted/decided). They are excluded from every rate.", "");
    for (const u of m.unmatchedPlanted) {
      L.push(`- Planted list row ${u.row}${u.shortId ? ` (\`${u.shortId}\`)` : ""}: planted=${u.planted}`);
    }
    L.push("");
  }

  L.push("## Limits", "");
  L.push("- One campaign and one primary reviewer; the sample is small, so every rate carries wide uncertainty. Counts are shown next to each percentage for that reason.");
  L.push("- The planted submissions were written and submitted by a second person; their style may not match real farming.");
  L.push("- The per-signal breakdown describes this sample only; a \"weak\" label is a prompt to revisit the signal, not a verdict on it.");
  L.push("");
  return L.join("\n");
}
