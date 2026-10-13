import { z } from "zod";
import { postIdSchema } from "@/domain/submission-url";
import { xUserIdSchema } from "@/domain/x-connect";
import { isAppError } from "@/lib/errors";
import type { XPort } from "./port";

/**
 * `pnpm x:check`: ask X who wrote one known post and compare the answer with
 * the account expected to have written it. No I/O of its own beyond the port,
 * so the mapping from X's answer to an exit code can be tested with a fake.
 *
 * Exit codes: 0 found and the author matches · 1 X answered, but the post was
 * not found or another account wrote it · 2 bad arguments · 3 X is not
 * configured, the environment is invalid, or X gave no usable answer.
 *
 * No line carries post text, a handle, an account ID or a token: the author's
 * ID is compared and dropped.
 */
export interface XCheckResult {
  exitCode: 0 | 1 | 2 | 3;
  /** What to print, without the `x:check: ` prefix. */
  lines: string[];
}

export const X_CHECK_USAGE = "usage: pnpm x:check <post id> <expected X account id>";

const argsSchema = z.tuple([postIdSchema, xUserIdSchema]);

/**
 * `argv` is what follows the script name; a leading `--`, as pnpm may pass it,
 * is ignored. `x` is called once and only for valid arguments: it returns the
 * port, null when X is not configured, or throws when the environment is refused.
 */
export async function xCheck(argv: readonly string[], x: () => XPort | null): Promise<XCheckResult> {
  const rest = argv.filter((a, i) => !(i === 0 && a === "--"));
  if (rest.length !== 2) return { exitCode: 2, lines: ["expected exactly two arguments", X_CHECK_USAGE] };
  const args = argsSchema.safeParse(rest);
  if (!args.success) return { exitCode: 2, lines: ["both arguments must be numeric IDs of 1 to 19 digits with no leading zero", X_CHECK_USAGE] };
  const [postId, expected] = args.data;

  try {
    const port = x();
    if (!port) return { exitCode: 3, lines: ["X is not configured: set X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI and X_BEARER_TOKEN"] };
    const author = await port.postAuthor(postId);
    if (!author.found) return { exitCode: 1, lines: ["post not found: X reports it as missing, deleted or not public"] };
    return author.authorId === expected
      ? { exitCode: 0, lines: ["post found", "author matches the expected account"] }
      : { exitCode: 1, lines: ["post found", "author does not match the expected account"] };
  } catch (e) {
    // The adapter's details hold the failed step, the reason and the HTTP status only: no body, no token.
    if (isAppError(e) && e.code === "X") {
      const d = e.details ?? {};
      const parts = (["step", "reason", "status", "resetAt"] as const).filter((k) => d[k] !== undefined).map((k) => `${k} ${String(d[k])}`);
      return { exitCode: 3, lines: [`X gave no usable answer (${parts.join(", ")})`] };
    }
    return { exitCode: 3, lines: [e instanceof Error ? e.message : String(e)] };
  }
}
