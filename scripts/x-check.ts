import { getX } from "../src/x";
import { xCheck } from "../src/x/check";

/**
 * Operator tool: ask X who wrote one known post, through the adapter and the
 * app-only token the app itself uses, before a campaign takes submissions.
 *
 *   pnpm x:check <post id> <expected X account id>
 *
 * Both arguments are numeric IDs: the post ID is the number at the end of the
 * post's link, the account ID is the numeric ID of the account that wrote it.
 * The check and its exit codes are `xCheck` in src/x/check.ts.
 */
xCheck(process.argv.slice(2), getX)
  .then(({ exitCode, lines }) => {
    const out = exitCode <= 1 ? process.stdout : process.stderr;
    for (const line of lines) out.write(line.startsWith("usage: ") ? `${line}\n` : `x:check: ${line}\n`);
    process.exit(exitCode);
  })
  .catch((e: unknown) => {
    process.stderr.write(`x:check: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(3);
  });
