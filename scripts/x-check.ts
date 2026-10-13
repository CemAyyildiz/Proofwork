import { z } from "zod";
import { postIdSchema } from "../src/domain/submission-url";
import { xUserIdSchema } from "../src/domain/x-connect";
import { isAppError } from "../src/lib/errors";
import { getX } from "../src/x";

/**
 * Operator tool: ask X who wrote one known post, through the adapter and the
 * app-only token the app itself uses, before a campaign takes submissions.
 *
 *   pnpm x:check <post id> <expected X account id>
 *
 * Both arguments are numeric IDs: the post ID is the number at the end of the
 * post's link, the account ID is the numeric ID of the account that wrote it.
 * Prints whether X found the post and whether its author is that account.
 * Never prints post text, a handle, the author's ID or the token.
 *
 * Exit codes: 0 found and the author matches · 1 X answered, but the post was
 * not found or another account wrote it · 2 bad arguments · 3 X is not
 * configured, the environment is invalid, or X gave no usable answer.
 */
const argsSchema = z.object({
  postId: postIdSchema,
  expected: xUserIdSchema,
});

function say(line: string): void {
  process.stdout.write(`x:check: ${line}\n`);
}

function fail(code: 2 | 3, line: string): never {
  process.stderr.write(`x:check: ${line}\n`);
  if (code === 2) process.stderr.write("usage: pnpm x:check <post id> <expected X account id>\n");
  process.exit(code);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  if (argv.length !== 2) fail(2, "expected exactly two arguments");
  const args = argsSchema.safeParse({ postId: argv[0], expected: argv[1] });
  if (!args.success) fail(2, "both arguments must be numeric IDs of 1 to 19 digits with no leading zero");

  const x = getX();
  if (!x) fail(3, "X is not configured: set X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI and X_BEARER_TOKEN");

  const author = await x.postAuthor(args.data.postId);
  if (!author.found) {
    say("post not found: X reports it as missing, deleted or not public");
    process.exit(1);
  }
  say("post found");
  if (author.authorId !== args.data.expected) {
    say("author does not match the expected account");
    process.exit(1);
  }
  say("author matches the expected account");
}

main().catch((e: unknown) => {
  // The adapter's details hold the failed step, the reason and the HTTP status only: no body, no token.
  if (isAppError(e) && e.code === "X") {
    const d = e.details ?? {};
    const parts = (["step", "reason", "status", "resetAt"] as const).filter((k) => d[k] !== undefined).map((k) => `${k} ${String(d[k])}`);
    fail(3, `X gave no usable answer (${parts.join(", ")})`);
  }
  fail(3, e instanceof Error ? e.message : String(e));
});
