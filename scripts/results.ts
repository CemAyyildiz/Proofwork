import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parsePlanted, parseReviewLog, parseSecond, renderResults, ResultsInputError, score } from "../src/domain/results";

/**
 * Scores the live campaign and writes docs/results.md (aggregate table only).
 *   pnpm results -- --log <review-log.csv> --planted <planted.csv> [--second <second-reviewer.csv>]
 * Reads local files only; nothing is imported into the database and nothing
 * touches the network. Keep the input files outside the repository.
 */
const argsSchema = z.object({
  log: z.string().trim().min(1, "--log <review-log.csv> is required"),
  planted: z.string().trim().min(1, "--planted <planted.csv> is required"),
  second: z.string().trim().min(1).optional(),
});

const OUT = resolve(import.meta.dirname, "..", "docs", "results.md");

function fail(message: string): never {
  process.stderr.write(`results: ${message}\n`);
  process.stderr.write("usage: pnpm results -- --log <review-log.csv> --planted <planted.csv> [--second <second-reviewer.csv>]\n");
  process.exit(1);
}

// pnpm runs scripts from the package root; resolve relative paths from where the caller typed them.
const CALLER_CWD = process.env["INIT_CWD"] ?? process.cwd();

function read(path: string): string {
  try {
    return readFileSync(resolve(CALLER_CWD, path), "utf8");
  } catch (e) {
    fail(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  let values: Record<string, unknown>;
  try {
    values = parseArgs({
      args: argv,
      options: { log: { type: "string" }, planted: { type: "string" }, second: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) fail(z.prettifyError(parsed.error));
  const args = parsed.data;

  try {
    const log = parseReviewLog(read(args.log));
    const planted = parsePlanted(read(args.planted));
    const second = args.second !== undefined ? parseSecond(read(args.second)) : undefined;
    const metrics = score(log, planted, second);
    writeFileSync(OUT, renderResults(metrics));
    for (const u of metrics.unmatchedPlanted) {
      process.stderr.write(`warning: planted list row ${u.row} matches no submission in the log; excluded from rates\n`);
    }
    process.stdout.write(`wrote ${OUT} (sample size ${metrics.sampleSize})\n`);
  } catch (e) {
    if (e instanceof ResultsInputError) fail(e.message);
    throw e;
  }
}

main();
