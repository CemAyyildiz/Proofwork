import { describe, expect, it, vi } from "vitest";
import { SIGNALS, type Signals } from "@/domain/rubric";
import { HONESTY_NOTE, parsePlanted, parseReviewLog, parseSecond, rate, renderResults, ResultsInputError, score } from "@/domain/results";
import { parseCsv, toCsv, type CsvCell } from "@/lib/csv";

vi.mock("@/db/client", () => ({ db: undefined }));
const { REVIEW_LOG_COLUMNS } = await import("@/services/review");

const ALL_PASS: Signals = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const FARM_FAIL: Signals = { ...ALL_PASS, content_original: false, task_done: false, not_spam: false };
const GENUINE_FAIL: Signals = { ...ALL_PASS, account_genuine: false, task_done: false, follows_brief: false };

type Row = Record<(typeof REVIEW_LOG_COLUMNS)[number], CsvCell>;
let clock = 0;

const P = (i: number): string => `pqz${i}wkx`;
const G = (i: number): string => `gqz${i}wkx`;

function decision(shortId: string, signals: Signals, opts: { appealOf?: string; campaign?: string; workUrl?: string } = {}): Row {
  clock += 1;
  const passCount = SIGNALS.filter((s) => signals[s.id]).length;
  const outcome = passCount >= 4 ? "PASS" : "FAIL";
  const sig = Object.fromEntries(SIGNALS.map((s) => [`signal_${s.id}`, signals[s.id]]));
  return {
    campaign_slug: opts.campaign ?? "live-1",
    submission_short_id: shortId,
    work_url: opts.workUrl ?? `https://x.com/user_${shortId}/status/${1000 + clock}`,
    contributor_pubkey: `G_${shortId}`,
    decision_id: `dec_${clock}`,
    is_appeal: opts.appealOf !== undefined,
    appeal_of: opts.appealOf ?? null,
    reviewer_pubkey: "G_REV",
    ...sig,
    pass_count: passCount,
    outcome,
    reason_code: outcome === "PASS" ? "R00_PASS" : "R06_SPAM",
    note: "=HYPERLINK(\"x\"), with a comma\nand a newline",
    decision_hash: "ab".repeat(32),
    ledger_key: `d_${shortId}`,
    tx_hash: null,
    explorer_url: null,
    decided_at: new Date(Date.UTC(2026, 8, 20, 0, 0, clock)).toISOString(),
    review_seconds: 42,
    blind: true,
    submission_status: outcome === "PASS" ? "decided" : "rejected",
    payout_status: null,
    release_tx_hash: null,
  } as Row;
}

/** The exact bytes the review-log route serves: BOM + toCsv(REVIEW_LOG_COLUMNS). */
function exportCsv(rows: Row[]): string {
  return `﻿${toCsv(REVIEW_LOG_COLUMNS, rows)}`;
}

function plantedCsv(rows: Array<{ id: string; planted: boolean }>): string {
  return toCsv(["submission_short_id", "planted"] as const, rows.map((r) => ({ submission_short_id: r.id, planted: r.planted })));
}

/** 10 planted (8 failed) and 20 genuine (2 failed). */
function workedExample(): { log: Row[]; planted: Array<{ id: string; planted: boolean }> } {
  const log: Row[] = [];
  const planted: Array<{ id: string; planted: boolean }> = [];
  for (let i = 0; i < 10; i += 1) {
    log.push(decision(P(i), i < 8 ? FARM_FAIL : ALL_PASS));
    planted.push({ id: P(i), planted: true });
  }
  for (let i = 0; i < 20; i += 1) {
    log.push(decision(G(i), i < 2 ? GENUINE_FAIL : ALL_PASS));
    planted.push({ id: G(i), planted: false });
  }
  return { log, planted };
}

describe("parseCsv", () => {
  it("round-trips toCsv output including quotes, commas, newlines and a BOM", () => {
    const text = `﻿${toCsv(["a", "b"] as const, [{ a: 'say "hi", ok', b: "line1\nline2" }, { a: "", b: "x" }])}`;
    expect(parseCsv(text)).toEqual({ header: ["a", "b"], rows: [{ a: 'say "hi", ok', b: "line1\nline2" }, { a: "", b: "x" }] });
  });

  it("rejects a ragged row and an unterminated quote", () => {
    expect(() => parseCsv("a,b\n1\n")).toThrow(/expected 2 cells/);
    expect(() => parseCsv('a\n"open\n')).toThrow(/unterminated/);
  });

  it("rejects duplicate column names after trimming", () => {
    expect(() => parseCsv("planted, planted\ntrue,false\n")).toThrow(/duplicate column "planted"/);
  });

  it("skips whitespace-only lines", () => {
    expect(parseCsv("a,b\n1,2\n   \n\t\n3,4\n").rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });
});

describe("score — worked example", () => {
  it("reports catch rate 80% (8/10), false-positive rate 10% (2/20), sample size 30", () => {
    const { log, planted } = workedExample();
    const m = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv(planted)));
    expect(m.sampleSize).toBe(30);
    expect(m.blind.planted).toEqual({ failed: 8, total: 10 });
    expect(m.blind.genuine).toEqual({ failed: 2, total: 20 });
    expect(rate(m.blind.planted.failed, m.blind.planted.total)).toBe("80% (8/10)");
    expect(rate(m.blind.genuine.failed, m.blind.genuine.total)).toBe("10% (2/20)");

    const byId = Object.fromEntries(m.signals.map((s) => [s.id, s]));
    expect(byId["not_spam"]).toMatchObject({ planted: { falseCount: 8, known: 10 }, genuine: { falseCount: 0, known: 20 }, status: "separates" });
    expect(byId["task_done"]?.separationPp).toBe(70);
    expect(byId["follows_brief"]).toMatchObject({ planted: { falseCount: 0, known: 10 }, genuine: { falseCount: 2, known: 20 }, status: "inverted" });
    expect(byId["single_account"]).toMatchObject({ separationPp: 0, status: "weak" });

    const md = renderResults(m);
    expect(md).toContain("| Catch rate | 80% (8/10) |");
    expect(md).toContain("| False-positive rate | 10% (2/20) |");
    expect(md).toContain("| Sample size (submissions with a decision) | 30 (10 planted, 20 genuine) |");
    expect(md).toContain("**Catch rate** = planted FAIL / planted total.");
    expect(md).toContain("**False-positive rate** = genuine FAIL / genuine total.");
    expect(md).toContain("| Not spam / farming | 80% (8/10) | 0% (0/20) | +80 pp | no |");
    expect(md).toContain("| Follows the brief | 0% (0/10) | 10% (2/20) | -10 pp | **inverted** |");
    expect(md).toContain("| Single-account check | 0% (0/10) | 0% (0/20) | 0 pp | **weak** |");
    expect(md).toContain(HONESTY_NOTE);
  });

  it("never writes a submission id or contributor data into the output", () => {
    const { log, planted } = workedExample();
    const first = decision(G(5), GENUINE_FAIL);
    log.push(first, decision(G(5), ALL_PASS, { appealOf: String(first.decision_id) }));
    const rows = parseReviewLog(exportCsv(log));
    const md = renderResults(
      score(rows, parsePlanted(plantedCsv([...planted, { id: "unknwn9x", planted: true }])), parseSecond(exportCsv(log))),
    );
    for (const r of rows) expect(md).not.toContain(r.shortId);
    expect(md).not.toContain("unknwn9x");
    expect(md).not.toMatch(/x\.com|G_pqz|G_gqz|HYPERLINK|dec_/);
  });

  it("treats an exact 20 pp split (3/10 vs 2/20) as separating, not weak", () => {
    const TASK_FAIL: Signals = { ...ALL_PASS, task_done: false };
    const log = [
      ...Array.from({ length: 10 }, (_, i) => decision(P(i), i < 3 ? TASK_FAIL : ALL_PASS)),
      ...Array.from({ length: 20 }, (_, i) => decision(G(i), i < 2 ? TASK_FAIL : ALL_PASS)),
    ];
    const planted = Array.from({ length: 10 }, (_, i) => ({ id: P(i), planted: true }));
    const task = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv(planted))).signals.find((s) => s.id === "task_done");
    expect(task).toMatchObject({ separationPp: 20, status: "separates" });
  });
});

describe("score — edge cases", () => {
  it("counts unmatched planted rows as not reviewed and excludes them from the rates", () => {
    const log = [decision(P(0), FARM_FAIL), decision(G(0), ALL_PASS)];
    const planted = [
      { id: P(0), planted: true },
      { id: P(1), planted: true },
      { id: G(7), planted: false },
    ];
    const m = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv(planted)));
    expect(m.unmatchedPlanted).toEqual([
      { row: 2, planted: true },
      { row: 3, planted: false },
    ]);
    expect(m.plantedNotReviewed).toBe(1);
    expect(m.genuineListedUnmatched).toBe(1);
    expect(m.blind.planted).toEqual({ failed: 1, total: 1 });
    expect(m.genuineUnlisted).toBe(1);
    const md = renderResults(m);
    expect(md).toContain("| Not reviewed (planted but never submitted/decided) | 1 |");
    expect(md).toContain("| Listed genuine, no matching submission | 1 |");
  });

  it("matches the planted list on work_url, x.com and twitter.com alike", () => {
    const row = decision(P(0), FARM_FAIL);
    const url = String(row.work_url).replace("https://x.com", "https://twitter.com") + "?s=20";
    const planted = parsePlanted(toCsv(["work_url", "planted"] as const, [{ work_url: url, planted: "TRUE" }]));
    expect(score(parseReviewLog(exportCsv([row])), planted).blind.planted).toEqual({ failed: 1, total: 1 });
  });

  it("refuses a planted row whose short id and work_url point to different submissions", () => {
    const a = decision(P(0), FARM_FAIL);
    const b = decision(G(0), ALL_PASS);
    const planted = parsePlanted(toCsv(["submission_short_id", "work_url", "planted"] as const, [{ submission_short_id: P(0), work_url: b.work_url, planted: "true" }]));
    expect(() => score(parseReviewLog(exportCsv([a, b])), planted)).toThrow(/point to different submissions/);
  });

  it("refuses a work_url shared by two submissions", () => {
    const url = "https://x.com/dup/status/1";
    const log = parseReviewLog(exportCsv([decision(P(0), FARM_FAIL, { workUrl: url }), decision(G(0), ALL_PASS, { workUrl: url })]));
    const planted = parsePlanted(toCsv(["work_url", "planted"] as const, [{ work_url: url, planted: "true" }]));
    expect(() => score(log, planted)).toThrow(/matches 2 submissions/);
  });

  it("uses the pre-appeal decision as the blind verdict and counts the overturn per group", () => {
    const first = decision(G(0), GENUINE_FAIL);
    const appeal = decision(G(0), ALL_PASS, { appealOf: String(first.decision_id) });
    const m = score(parseReviewLog(exportCsv([appeal, first])), parsePlanted(plantedCsv([{ id: G(0), planted: false }])));
    expect(m.blind.genuine).toEqual({ failed: 1, total: 1 });
    expect(m.final.genuine).toEqual({ failed: 0, total: 1 });
    expect(m.appeals).toEqual({ planted: { appealed: 0, overturned: 0 }, genuine: { appealed: 1, overturned: 1 } });
    expect(renderResults(m)).toContain("| Genuine | 1 | 1 |");
  });

  it("refuses a submission with only appeal decisions", () => {
    const log = parseReviewLog(exportCsv([decision(G(0), ALL_PASS, { appealOf: "dec_x" })]));
    expect(() => score(log, [])).toThrow(/only appeal decisions/);
  });

  it("refuses a log that mixes campaigns", () => {
    const log = parseReviewLog(exportCsv([decision(P(0), FARM_FAIL), decision(G(0), ALL_PASS, { campaign: "other" })]));
    expect(() => score(log, [])).toThrow(/2 campaigns/);
  });

  it("shows n/a (0) instead of dividing by zero", () => {
    const m = score(parseReviewLog(exportCsv([decision(G(0), ALL_PASS)])), []);
    const md = renderResults(m);
    expect(md).toContain("| Catch rate | n/a (0) |");
    expect(m.signals.every((s) => s.separationPp === null && s.status === "no data")).toBe(true);
    expect(renderResults(score([], []))).toContain("| False-positive rate | n/a (0) |");
  });

  it("refuses a submission listed as both planted and genuine", () => {
    const log = parseReviewLog(exportCsv([decision(P(0), FARM_FAIL)]));
    expect(() => score(log, parsePlanted(plantedCsv([{ id: P(0), planted: true }, { id: P(0), planted: false }])))).toThrow(ResultsInputError);
  });
});

describe("parsing errors", () => {
  it("names a missing review-log column", () => {
    expect(() => parseReviewLog("submission_short_id,outcome\nabc,PASS\n")).toThrow(/missing column "campaign_slug"/);
  });

  it("rejects a malformed planted value with the zod message and the row", () => {
    expect(() => parsePlanted("submission_short_id,planted\nabc,maybe\n")).toThrow(/planted list: data row 1: .*planted/s);
  });

  it("requires an id column in the planted list", () => {
    expect(() => parsePlanted("planted\ntrue\n")).toThrow(/submission_short_id" or "work_url"/);
  });

  it("rejects a bad outcome in the review log", () => {
    const bad = exportCsv([decision(G(0), ALL_PASS)]).replace(",PASS,", ",MAYBE,");
    expect(() => parseReviewLog(bad)).toThrow(/data row 1/);
  });

  it("rejects a decided_at that is not an ISO datetime", () => {
    const row = decision(G(0), ALL_PASS);
    const bad = exportCsv([row]).replace(String(row.decided_at), "20 Sep 2026");
    expect(() => parseReviewLog(bad)).toThrow(/data row 1: .*decided_at/s);
  });
});

describe("second reviewer", () => {
  it("reports agreement and Cohen's kappa on the overlap", () => {
    const { log, planted } = workedExample();
    // Second reviewer agrees on P0..P7 (FAIL) and G2..G9 (PASS), disagrees on P8 and G0.
    const second = [
      ...Array.from({ length: 8 }, (_, i) => ({ submission_short_id: P(i), outcome: "FAIL" })),
      { submission_short_id: P(8), outcome: " fail " },
      { submission_short_id: G(0), outcome: "pass" },
      ...Array.from({ length: 8 }, (_, i) => ({ submission_short_id: G(i + 2), outcome: "PASS" })),
      { submission_short_id: G(2), outcome: "PASS" },
      { submission_short_id: "nope", outcome: "PASS" },
    ];
    const m = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv(planted)), parseSecond(toCsv(["submission_short_id", "outcome"] as const, second)));
    // First reviewer on the 18 overlapping: FAIL = P0..P7 + G0 = 9, PASS = 9. Second: FAIL = 9, PASS = 9. Agree 16/18.
    expect(m.agreement).toMatchObject({ n: 18, agree: 16, unmatched: 1, duplicates: 1 });
    // po = 16/18, pe = 0.5 → κ = (0.8889 - 0.5) / 0.5 = 0.7778
    expect(m.agreement?.kappa).toBeCloseTo(0.7778, 3);
    const md = renderResults(m);
    expect(md).toContain("| Cohen's κ | 0.78 (n=18) |");
    expect(md).toContain("| Duplicate second-reviewer rows (ignored) | 1 |");
  });

  it("accepts a review log export as the second-reviewer file, skipping appeals", () => {
    const first = decision(G(0), GENUINE_FAIL);
    const appeal = decision(G(0), ALL_PASS, { appealOf: String(first.decision_id) });
    const text = exportCsv([first, appeal]);
    expect(parseSecond(text)).toHaveLength(1);
    const m = score(parseReviewLog(text), [], parseSecond(text));
    expect(m.agreement).toMatchObject({ n: 1, agree: 1, kappa: null, duplicates: 0 });
  });
});
