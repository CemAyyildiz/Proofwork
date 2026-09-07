import { z } from "zod";

/**
 * Only X / Twitter status URLs are accepted (SOW: X is the only platform).
 * The server never fetches this URL; it is stored and displayed only.
 */
const STATUS_URL = /^https:\/\/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})(?:[/?#].*)?$/;

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
