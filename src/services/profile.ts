import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db/client";
import { campaigns, payouts, profiles, submissions, xAccounts } from "@/db/schema";
import { isCountryCode, PROFILE_LIMITS, TELEGRAM_PATTERN } from "@/domain/profile";
import { pubkeySchema } from "@/domain/wallet-auth";
import { AppError } from "@/lib/errors";
import { contributorPayouts, type RecentPayout } from "./public-directory";

/**
 * A wallet's profile. Display name and bio are public; Telegram and
 * city/country are returned only by `getOwnProfile`, which callers use for
 * the session wallet. `publicProfile` selects the public columns by name, so
 * a contact field cannot reach a public page by accident.
 */
/**
 * No control characters and no format characters (`\p{Cf}`: bidi overrides
 * and isolates, zero-width spaces and joiners, BOM), which can reorder a name
 * or make it look blank in a headline or a page title.
 */
const PLAIN_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
/** The same, except that a bio may break lines. */
const PLAIN_LINES = /^[^\p{Cf}\u0000-\u0009\u000b-\u001f\u007f-\u009f]*$/u;
const PLAIN = "no control or invisible formatting characters";

/** An optional field: missing, null or blank all mean "not given". */
function optional<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v), inner.nullable());
}

/** The body of a save. It has no pubkey: the row is always the session wallet's. Unknown keys are dropped. */
export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(PROFILE_LIMITS.displayName).regex(PLAIN_TEXT, PLAIN),
  // Windows and old Mac line breaks become plain newlines before the checks.
  bio: optional(
    z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v),
      z.string().trim().max(PROFILE_LIMITS.bio).regex(PLAIN_LINES, PLAIN),
    ),
  ),
  telegram: optional(
    z
      .string()
      .trim()
      .regex(TELEGRAM_PATTERN, "a Telegram username: 5–32 letters, digits or underscores, starting with a letter")
      .transform((v) => v.replace(/^@/, "")),
  ),
  country: optional(z.string().refine(isCountryCode, "an ISO 3166-1 alpha-2 country code")),
  city: optional(z.string().trim().max(PROFILE_LIMITS.city).regex(PLAIN_TEXT, PLAIN)),
});

/** What a caller hands `saveProfile`; the schema decides what is kept. */
export interface ProfileInput {
  displayName: string;
  bio?: string | null;
  telegram?: string | null;
  country?: string | null;
  city?: string | null;
}

export interface OwnProfile {
  displayName: string | null;
  bio: string | null;
  telegram: string | null;
  country: string | null;
  city: string | null;
  promptedAt: Date;
  updatedAt: Date;
}

/** The session wallet's own profile, contact fields included. Never call this for another wallet. */
export async function getOwnProfile(pubkey: string, conn: Db = db): Promise<OwnProfile | null> {
  const row = (await conn.select().from(profiles).where(eq(profiles.pubkey, pubkey)).limit(1))[0];
  if (!row) return null;
  return { displayName: row.displayName, bio: row.bio, telegram: row.telegram, country: row.country, city: row.city, promptedAt: row.promptedAt, updatedAt: row.updatedAt };
}

function ownerOf(actor: { pubkey: string }): string {
  const pk = pubkeySchema.safeParse(actor.pubkey);
  if (!pk.success) throw AppError.unauthenticated();
  return pk.data;
}

/** Saves the actor's own profile; the row is keyed by the actor alone, whatever the input carries. */
export async function saveProfile(input: ProfileInput, actor: { pubkey: string }, conn: Db = db): Promise<OwnProfile> {
  const pubkey = ownerOf(actor);
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    throw AppError.validation("invalid profile", { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
  }
  const v = parsed.data;
  const fields = { displayName: v.displayName, bio: v.bio, telegram: v.telegram, country: v.country, city: v.city, updatedAt: new Date() };
  const [row] = await conn
    .insert(profiles)
    .values({ pubkey, ...fields })
    .onConflictDoUpdate({ target: profiles.pubkey, set: fields })
    .returning();
  if (!row) throw new AppError("INTERNAL", "profile write returned no row");
  return { displayName: row.displayName, bio: row.bio, telegram: row.telegram, country: row.country, city: row.city, promptedAt: row.promptedAt, updatedAt: row.updatedAt };
}

/** "Later": records that the actor was asked, so the prompt never comes back. A saved profile is left as it is. */
export async function dismissPrompt(actor: { pubkey: string }, conn: Db = db): Promise<void> {
  const pubkey = ownerOf(actor);
  await conn.insert(profiles).values({ pubkey }).onConflictDoNothing({ target: profiles.pubkey });
}

export interface ApprovedSubmission {
  workUrl: string;
  campaignTitle: string;
  campaignSlug: string;
  submittedAt: Date;
}

export interface PublicProfile {
  pubkey: string;
  displayName: string;
  bio: string | null;
  /** Built from the connected X account's numeric ID; X resolves it to the profile. */
  xUrl: string | null;
  /** The newest approved posts and released payouts, at most `LIST_LIMIT` each. */
  submissions: ApprovedSubmission[];
  payouts: RecentPayout[];
  /** Counted over every row, not just the listed ones. */
  approvedCount: number;
  payoutCount: number;
  /** Sum of the released payouts as they left the escrow, a USDC decimal string. */
  paidAmount: string;
}

const LIST_LIMIT = 50;

/** What `/u/<pubkey>` shows, or null when the wallet never saved a display name. No contact field is read. */
export async function publicProfile(pubkey: string, conn: Db = db): Promise<PublicProfile | null> {
  const [row] = await conn
    .select({ displayName: profiles.displayName, bio: profiles.bio, xUserId: xAccounts.xUserId })
    .from(profiles)
    .leftJoin(xAccounts, eq(xAccounts.pubkey, profiles.pubkey))
    .where(eq(profiles.pubkey, pubkey))
    .limit(1);
  if (!row?.displayName) return null;
  // A PASS leaves a submission `decided`; its release makes it `paid`.
  const isApproved = and(eq(submissions.contributorPubkey, pubkey), inArray(submissions.status, ["decided", "paid"]));
  const approved = await conn
    .select({ workUrl: submissions.workUrl, campaignTitle: campaigns.title, campaignSlug: campaigns.slug, submittedAt: submissions.submittedAt })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(isApproved)
    .orderBy(desc(submissions.submittedAt))
    .limit(LIST_LIMIT);
  const [approvedTotal] = await conn.select({ n: sql<number>`count(*)::int` }).from(submissions).where(isApproved);
  // The same rows `contributorPayouts` lists: released, with the transaction that paid them.
  const [paid] = await conn
    .select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${payouts.amount}), 0)::text` })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(and(eq(submissions.contributorPubkey, pubkey), eq(payouts.status, "released"), isNotNull(payouts.releaseTxHash), isNotNull(payouts.releasedAt)));
  return {
    pubkey,
    displayName: row.displayName,
    bio: row.bio,
    xUrl: row.xUserId ? `https://x.com/i/user/${row.xUserId}` : null,
    submissions: approved,
    payouts: await contributorPayouts(pubkey, LIST_LIMIT, conn),
    approvedCount: approvedTotal?.n ?? 0,
    payoutCount: paid?.n ?? 0,
    paidAmount: paid?.amount ?? "0",
  };
}
