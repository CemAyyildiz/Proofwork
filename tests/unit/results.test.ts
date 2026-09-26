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

function decision(shortId: string, signals: Signals | null, opts: { appealOf?: string; outcome?: "PASS" | "FAIL" } = {}): Row {
  clock += 1;
  const passCount = signals ? SIGNALS.filter((s) => signals[s.id]).length : 0;
  const outcome = opts.outcome ?? (signals ? (passCount >= 4 ? "PASS" : "FAIL") : null);
  const sig = Object.fromEntries(SIGNALS.map((s) => [`signal_${s.id}`, signals ? signals[s.id] : null]));
  return {
    campaign_slug: "live-1",
    submission_short_id: shortId,
    work_url: `https://x.com/user_${shortId}/status/${1000 + clock}`,
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
    log.push(decision(`p${i}`, i < 8 ? FARM_FAIL : ALL_PASS));
    planted.push({ id: `p${i}`, planted: true });
  }
  for (let i = 0; i < 20; i += 1) {
    log.push(decision(`g${i}`, i < 2 ? GENUINE_FAIL : ALL_PASS));
    planted.push({ id: `g${i}`, planted: false });
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
    expect(byId["not_spam"]).toMatchObject({ planted: { falseCount: 8, known: 10 }, genuine: { falseCount: 0, known: 20 }, weak: false });
    expect(byId["task_done"]?.separation).toBeCloseTo(0.7);
    expect(byId["follows_brief"]).toMatchObject({ planted: { falseCount: 0, known: 10 }, genuine: { falseCount: 2, known: 20 }, weak: true });
    expect(byId["single_account"]).toMatchObject({ separation: 0, weak: true });

    const md = renderResults(m);
    expect(md).toContain("| Catch rate | 80% (8/10) |");
    expect(md).toContain("| False-positive rate | 10% (2/20) |");
    expect(md).toContain("| Sample size (submissions with a decision) | 30 (10 planted, 20 genuine) |");
    expect(md).toContain("**Catch rate** = planted FAIL / planted total.");
    expect(md).toContain("**False-positive rate** = genuine FAIL / genuine total.");
    expect(md).toContain("| Not spam / farming | 80% (8/10) | 0% (0/20) | +80 pp | no |");
    expect(md).toContain("| Follows the brief | 0% (0/10) | 10% (2/20) | -10 pp | **weak** |");
    expect(md).toContain(HONESTY_NOTE);
  });

  it("never writes contributor data (work URLs, pubkeys) into the output", () => {
    const { log, planted } = workedExample();
    const md = renderResults(score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv(planted))));
    expect(md).not.toMatch(/x\.com|G_p0|G_g0|HYPERLINK/);
  });
});

describe("score — edge cases", () => {
  it("lists an unmatched planted row and excludes it from the rates", () => {
    const log = [decision("p0", FARM_FAIL), decision("g0", ALL_PASS)];
    const m = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv([{ id: "p0", planted: true }, { id: "zz9", planted: true }])));
    expect(m.unmatchedPlanted).toEqual([{ row: 2, shortId: "zz9", planted: true }]);
    expect(m.blind.planted).toEqual({ failed: 1, total: 1 });
    expect(renderResults(m)).toContain("planted but never submitted/decided");
  });

  it("matches the planted list on work_url, x.com and twitter.com alike", () => {
    const row = decision("p0", FARM_FAIL);
    const url = String(row.work_url).replace("https://x.com", "https://twitter.com") + "?s=20";
    const planted = parsePlanted(toCsv(["work_url", "planted"] as const, [{ work_url: url, planted: "TRUE" }]));
    expect(score(parseReviewLog(exportCsv([row])), planted).blind.planted).toEqual({ failed: 1, total: 1 });
  });

  it("counts a submission without a decision as not reviewed", () => {
    const log = [decision("p0", null), decision("g0", ALL_PASS)];
    const m = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv([{ id: "p0", planted: true }])));
    expect(m.notReviewed).toEqual({ planted: 1, genuine: 0 });
    expect(m.sampleSize).toBe(1);
    expect(m.genuineUnlisted).toBe(1);
  });

  it("uses the pre-appeal decision as the blind verdict and reports the overturn", () => {
    const first = decision("g0", GENUINE_FAIL);
    const appeal = decision("g0", ALL_PASS, { appealOf: String(first.decision_id) });
    const m = score(parseReviewLog(exportCsv([appeal, first])), parsePlanted(plantedCsv([{ id: "g0", planted: false }])));
    expect(m.blind.genuine).toEqual({ failed: 1, total: 1 });
    expect(m.final.genuine).toEqual({ failed: 0, total: 1 });
    expect(m.appeals).toEqual([{ shortId: "g0", group: "genuine", blind: "FAIL", final: "PASS" }]);
    expect(renderResults(m)).toContain("| `g0` | genuine | FAIL | PASS | yes |");
  });

  it("shows n/a (0) instead of dividing by zero", () => {
    const m = score(parseReviewLog(exportCsv([decision("g0", ALL_PASS)])), []);
    const md = renderResults(m);
    expect(md).toContain("| Catch rate | n/a (0) |");
    expect(m.signals.every((s) => s.separation === null && s.weak)).toBe(true);
    expect(renderResults(score([], []))).toContain("| False-positive rate | n/a (0) |");
  });

  it("refuses a submission listed as both planted and genuine", () => {
    const log = parseReviewLog(exportCsv([decision("p0", FARM_FAIL)]));
    expect(() => score(log, parsePlanted(plantedCsv([{ id: "p0", planted: true }, { id: "p0", planted: false }])))).toThrow(ResultsInputError);
  });
});

describe("parsing errors", () => {
  it("names a missing review-log column", () => {
    expect(() => parseReviewLog("submission_short_id,outcome\nabc,PASS\n")).toThrow(/missing column "campaign_slug"/);
  });

  it("rejects a malformed planted value with the zod message and the row", () => {
    const err = (() => {
      try {
        parsePlanted("submission_short_id,planted\nabc,maybe\n");
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ResultsInputError);
    expect(String((err as Error).message)).toMatch(/planted list: data row 1: .*planted/s);
  });

  it("requires an id column in the planted list", () => {
    expect(() => parsePlanted("planted\ntrue\n")).toThrow(/submission_short_id" or "work_url"/);
  });

  it("rejects a bad outcome in the review log", () => {
    const bad = exportCsv([decision("g0", ALL_PASS)]).replace(",PASS,", ",MAYBE,");
    expect(() => parseReviewLog(bad)).toThrow(/data row 1/);
  });
});

describe("second reviewer", () => {
  it("reports agreement and Cohen's kappa on the overlap", () => {
    const { log, planted } = workedExample();
    // Second reviewer agrees on p0..p7 (FAIL) and g2..g9 (PASS), disagrees on p8 and g0.
    const second = [
      ...Array.from({ length: 8 }, (_, i) => ({ submission_short_id: `p${i}`, outcome: "FAIL" })),
      { submission_short_id: "p8", outcome: "FAIL" },
      { submission_short_id: "g0", outcome: "PASS" },
      ...Array.from({ length: 8 }, (_, i) => ({ submission_short_id: `g${i + 2}`, outcome: "PASS" })),
      { submission_short_id: "nope", outcome: "PASS" },
    ];
    const m = score(parseReviewLog(exportCsv(log)), parsePlanted(plantedCsv(planted)), parseSecond(toCsv(["submission_short_id", "outcome"] as const, second)));
    // First reviewer on the 18 overlapping: FAIL = p0..p7 + g0 = 9, PASS = 9. Second: FAIL = 9, PASS = 9. Agree 16/18.
    expect(m.agreement).toMatchObject({ n: 18, agree: 16, unmatched: 1 });
    // po = 16/18, pe = 0.5 → κ = (0.8889 - 0.5) / 0.5 = 0.7778
    expect(m.agreement?.kappa).toBeCloseTo(0.7778, 3);
    expect(renderResults(m)).toContain("| Cohen's κ | 0.78 (n=18) |");
  });

  it("accepts a review log export as the second-reviewer file, skipping appeals", () => {
    const first = decision("g0", GENUINE_FAIL);
    const appeal = decision("g0", ALL_PASS, { appealOf: String(first.decision_id) });
    const text = exportCsv([first, appeal]);
    expect(parseSecond(text)).toHaveLength(1);
    const m = score(parseReviewLog(text), [], parseSecond(text));
    expect(m.agreement).toMatchObject({ n: 1, agree: 1, kappa: null });
  });
});
