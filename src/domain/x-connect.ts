import { z } from "zod";

/**
 * Pure rules shared by the X connect routes, the service and the campaign
 * page. No I/O.
 */

/** X documents a user ID as `^[0-9]{1,19}$`. Kept as a decimal string, in its one canonical spelling: no leading zero. */
export const xUserIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/);

/**
 * Where the contributor goes back to after the flow: a campaign slug, never a
 * URL. The alphabet is what `slugify` in services/campaign.ts can produce.
 */
export const returnSlugSchema = z.string().regex(/^[a-z0-9_-]{1,80}$/);

/** Every way a connect attempt can end. The campaign page reads one as `?x=<outcome>`. */
export const X_OUTCOMES = [
  "connected",
  "taken",
  "wallet_bound",
  "cancelled",
  "retry",
  "signin",
  "x_failed",
  "unavailable",
  "rate_limited",
] as const;

export type XOutcome = (typeof X_OUTCOMES)[number];

export const xOutcomeSchema = z.enum(X_OUTCOMES);

/** The campaign page's submit panel with the outcome attached. Both parts come from fixed alphabets. */
export function returnPath(slug: string, outcome: XOutcome): string {
  return `/c/${slug}?x=${outcome}#submit`;
}

/** Where an attempt ends when nothing says which campaign started it: the campaign list, with the outcome. */
export function noCampaignPath(outcome: XOutcome): string {
  return `/explore?x=${outcome}`;
}
