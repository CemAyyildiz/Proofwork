import { z } from "zod";

/**
 * A post ID as X documents it (`^[0-9]{1,19}$`), kept to its one canonical
 * spelling: no leading zero, so one post cannot be written as two IDs.
 */
const POST_ID = "[1-9][0-9]{0,18}";

export const postIdSchema = z.string().regex(new RegExp(`^${POST_ID}$`));

/**
 * Only X / Twitter status URLs are accepted (SOW: X is the only platform).
 * The server never fetches this URL; it is stored and displayed. The post ID
 * in it is what identifies the post: it is the key of the author lookup and of
 * the one-submission-per-post rule, whatever handle or host the link carries.
 */
const STATUS_URL = new RegExp(`^https://(?:x\\.com|twitter\\.com)/([A-Za-z0-9_]{1,15})/status/(${POST_ID})(?:[/?#].*)?$`);

export const submissionUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => STATUS_URL.test(v), "must be a public X post URL, e.g. https://x.com/handle/status/123");

/** Canonical form: scheme + host normalised to x.com, no query/fragment. */
export function canonicalizeSubmissionUrl(input: string): { url: string; handle: string; statusId: string } {
  const m = STATUS_URL.exec(input.trim());
  if (!m) throw new Error("invalid submission url");
  const handle = m[1] as string;
  const statusId = m[2] as string;
  return { url: `https://x.com/${handle}/status/${statusId}`, handle, statusId };
}
