import "server-only";
import { and, count, countDistinct, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { StellarNetwork } from "@/config/network";
import type { Db } from "@/db/client";
import { authNonces, campaigns, decisions, payouts, profiles, submissions, xAccounts } from "@/db/schema";
import { fromStroops, toStroops } from "@/escrow/amount";
import { csvCell, toCsv, type CsvCell } from "@/lib/csv";
import { requireOps } from "./access";

/**
 * Usage figures for the operator, read-only and computed from the tables the
 * app already writes: used sign-in nonces, X links, submissions, decisions,
 * payouts, campaigns and profiles. Each deployment has its own database, so
 * every figure is for the network it serves. Only aggregates leave this
 * module: no wallet address, contact field or per-user row.
 */

const DAY_MS = 86_400_000;

export interface MetricsSummary {
  users: number;
  active1d: number;
  active7d: number;
  active30d: number;
  xVerified: number;
  contributors: number;
  approved: number;
  paidUsers: number;
  /** Decimal string, e.g. "12.5". */
  usdcPaid: string;
  funders: number;
}

export type SummaryKey = keyof MetricsSummary;

/** The summary figures in page and CSV order, each with the definition shown beside it. */
export const SUMMARY_FIGURES: ReadonlyArray<{ key: SummaryKey; label: string; definition: string }> = [
  { key: "users", label: "Users", definition: "Distinct wallets with a used sign-in nonce." },
  { key: "active1d", label: "Active, 1 day", definition: "Distinct wallets with a sign-in in the last 24 hours." },
  { key: "active7d", label: "Active, 7 days", definition: "Distinct wallets with a sign-in in the last 7 days." },
  { key: "active30d", label: "Active, 30 days", definition: "Distinct wallets with a sign-in in the last 30 days." },
  { key: "xVerified", label: "X-verified", definition: "Rows in x_account: wallets with a connected X account." },
  { key: "contributors", label: "Contributors", definition: "Distinct submitters." },
  { key: "approved", label: "Approved", definition: "Submissions with a PASS decision." },
  { key: "paidUsers", label: "Paid users", definition: "Distinct contributors with a released payout." },
  { key: "usdcPaid", label: "USDC paid", definition: "The sum of released payouts." },
  { key: "funders", label: "Funders", definition: "Distinct funders of funded campaigns." },
];

export interface WeekRow {
  /** Monday of the ISO week, UTC, YYYY-MM-DD. */
  start: string;
  /** ISO week, e.g. "2026-W48". */
  label: string;
  /** Distinct wallets that signed in during the week. */
  signedIn: number;
  /** Wallets whose first sign-in fell in the week. */
  newWallets: number;
}

export interface CampaignMetricsRow {
  slug: string;
  title: string;
  submissions: number;
  approved: number;
  paid: number;
  /** Decimal string. */
  usdcPaid: string;
}

export interface CountryRow {
  /** ISO 3166-1 alpha-2, or null for "not given". */
  country: string | null;
  users: number;
}

export interface MetricsOverview {
  generatedAt: Date;
  summary: MetricsSummary;
  /** Users with a display name; the share of `summary.users` is the profile completion. */
  withDisplayName: number;
  /** From the first week with a sign-in to the current week, gaps filled with zeros. Empty with no sign-ins. */
  weeks: WeekRow[];
  /** Every campaign, newest first. */
  campaigns: CampaignMetricsRow[];
  /** Users per country, most first; "not given" (null) last. */
  countries: CountryRow[];
}

/** Monday of the ISO week holding `d`, UTC, as YYYY-MM-DD. */
export function isoWeekStart(d: Date): string {
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}

/** ISO 8601 week of a Monday (YYYY-MM-DD): the week belongs to the year of its Thursday. */
export function isoWeekLabel(start: string): string {
  const thursday = new Date(Date.parse(`${start}T00:00:00Z`) + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Joins the two per-week counts into one row per ISO week, from the earliest
 * week either has to the week of `now` (or the latest week in the data, if
 * later), so a quiet week reads as zero instead of being skipped.
 */
export function weekSeries(signedIn: ReadonlyArray<{ week: string; n: number }>, fresh: ReadonlyArray<{ week: string; n: number }>, now: Date): WeekRow[] {
  const weeks = [...signedIn, ...fresh].map((r) => r.week).sort();
  const first = weeks[0];
  if (first === undefined) return [];
  const current = isoWeekStart(now);
  const last = weeks[weeks.length - 1] as string;
  const end = last > current ? last : current;
  const byWeek = (rows: ReadonlyArray<{ week: string; n: number }>) => new Map(rows.map((r) => [r.week, r.n]));
  const s = byWeek(signedIn);
  const f = byWeek(fresh);
  const out: WeekRow[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); ; t += 7 * DAY_MS) {
    const start = new Date(t).toISOString().slice(0, 10);
    out.push({ start, label: isoWeekLabel(start), signedIn: s.get(start) ?? 0, newWallets: f.get(start) ?? 0 });
    if (start >= end) break;
  }
  return out;
}

/** Monday of the ISO week of a timestamp column, in UTC, as text: the same on every driver. */
const weekOf = (column: SQL | typeof authNonces.usedAt): SQL<string> => sql<string>`to_char(date_trunc('week', ${column} at time zone 'UTC'), 'YYYY-MM-DD')`;

/** A sum of numeric(18,7) as a decimal string, "0" when there is nothing to sum. */
const usdc = (column: typeof payouts.amount): SQL<string> => sql<string>`coalesce(sum(${column}), 0)::text`;

/** Released on chain: the status alone is not enough, the release transaction hash must be stored too. */
const released = and(eq(payouts.status, "released"), isNotNull(payouts.releaseTxHash));

/** Everything the metrics page and CSV show. Ops only; reads nothing else and writes nothing. */
export async function metricsOverview(actor: { pubkey: string }, conn: Db, now: Date = new Date()): Promise<MetricsOverview> {
  await requireOps(actor.pubkey, conn);
  const signedIn = isNotNull(authNonces.usedAt);
  const activeSince = (days: number) => {
    const since = new Date(now.getTime() - days * DAY_MS).toISOString();
    return sql<number>`count(distinct ${authNonces.pubkey}) filter (where ${authNonces.usedAt} > ${since}::timestamptz)`.mapWith(Number);
  };

  const [signIns] = await conn
    .select({ users: countDistinct(authNonces.pubkey), active1d: activeSince(1), active7d: activeSince(7), active30d: activeSince(30) })
    .from(authNonces)
    .where(signedIn);
  const [x] = await conn.select({ n: count() }).from(xAccounts);
  const [contributors] = await conn.select({ n: countDistinct(submissions.contributorPubkey) }).from(submissions);
  const [approved] = await conn.select({ n: countDistinct(decisions.submissionId) }).from(decisions).where(eq(decisions.outcome, "PASS"));
  const [paid] = await conn
    .select({ users: countDistinct(submissions.contributorPubkey), usdc: usdc(payouts.amount) })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(released);
  const [funders] = await conn.select({ n: countDistinct(campaigns.funderPubkey) }).from(campaigns).where(isNotNull(campaigns.fundedAt));

  // Weekly: distinct wallets per week of sign-in, and wallets per week of their first sign-in.
  const week = weekOf(authNonces.usedAt);
  const perWeek = await conn.select({ week, n: countDistinct(authNonces.pubkey) }).from(authNonces).where(signedIn).groupBy(week);
  const firsts = conn
    .select({ pubkey: authNonces.pubkey, first: sql`min(${authNonces.usedAt})`.as("first_used_at") })
    .from(authNonces)
    .where(signedIn)
    .groupBy(authNonces.pubkey)
    .as("firsts");
  const firstWeek = weekOf(sql`${firsts.first}`);
  const freshPerWeek = await conn.select({ week: firstWeek, n: count() }).from(firsts).groupBy(firstWeek);

  // Countries and display names, per user (a wallet with a sign-in), whether or not it has a profile row.
  const users = conn.selectDistinct({ pubkey: authNonces.pubkey }).from(authNonces).where(signedIn).as("users");
  const byCountry = await conn
    .select({ country: profiles.country, users: count(), named: count(profiles.displayName) })
    .from(users)
    .leftJoin(profiles, eq(profiles.pubkey, users.pubkey))
    .groupBy(profiles.country);

  // Per campaign: three grouped reads merged here, so one join cannot multiply another's rows.
  const list = await conn
    .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt), desc(campaigns.id));
  const subs = await conn.select({ id: submissions.campaignId, n: count() }).from(submissions).groupBy(submissions.campaignId);
  const passes = await conn
    .select({ id: submissions.campaignId, n: countDistinct(decisions.submissionId) })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(eq(decisions.outcome, "PASS"))
    .groupBy(submissions.campaignId);
  const pays = await conn
    .select({ id: submissions.campaignId, n: count(), usdc: usdc(payouts.amount) })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(released)
    .groupBy(submissions.campaignId);
  const subsBy = new Map(subs.map((r) => [r.id, r.n]));
  const passBy = new Map(passes.map((r) => [r.id, r.n]));
  const payBy = new Map(pays.map((r) => [r.id, r]));

  const countries = byCountry
    .map((r) => ({ country: r.country, users: r.users }))
    .sort((a, b) => (a.country === null ? 1 : b.country === null ? -1 : b.users - a.users || a.country.localeCompare(b.country)));

  return {
    generatedAt: now,
    summary: {
      users: signIns?.users ?? 0,
      active1d: signIns?.active1d ?? 0,
      active7d: signIns?.active7d ?? 0,
      active30d: signIns?.active30d ?? 0,
      xVerified: x?.n ?? 0,
      contributors: contributors?.n ?? 0,
      approved: approved?.n ?? 0,
      paidUsers: paid?.users ?? 0,
      usdcPaid: decimal(paid?.usdc ?? "0"),
      funders: funders?.n ?? 0,
    },
    withDisplayName: byCountry.reduce((sum, r) => sum + r.named, 0),
    weeks: weekSeries(perWeek, freshPerWeek, now),
    campaigns: list.map((c) => {
      const p = payBy.get(c.id);
      return { slug: c.slug, title: c.title, submissions: subsBy.get(c.id) ?? 0, approved: passBy.get(c.id) ?? 0, paid: p?.n ?? 0, usdcPaid: decimal(p?.usdc ?? "0") };
    }),
    countries,
  };
}

/** "12.5" from Postgres' "12.5000000". */
function decimal(v: string): string {
  return fromStroops(toStroops(v));
}

/** Share of users with a display name, in percent to one decimal; 0 with no users. */
export function profileCompletion(o: Pick<MetricsOverview, "withDisplayName" | "summary">): number {
  return o.summary.users === 0 ? 0 : Math.round((o.withDisplayName / o.summary.users) * 1000) / 10;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });

/** English name of an ISO country code, or "not given". */
export function countryName(code: string | null): string {
  return code === null ? "not given" : (regionNames.of(code) ?? code);
}

/** Path of a campaign's public page. */
export function campaignPath(slug: string): string {
  return `/c/${encodeURIComponent(slug)}`;
}

export function metricsFilename(network: StellarNetwork, now: Date): string {
  return `proofwork-metrics-${network}-${now.toISOString().slice(0, 10)}.csv`;
}

function section<K extends string>(title: string, columns: readonly K[], rows: ReadonlyArray<Record<K, CsvCell>>): string {
  return `${csvCell(title)}\r\n${toCsv(columns, rows)}`;
}

/**
 * The overview as one RFC 4180 file: a titled section per table (summary,
 * weekly, campaigns, countries), separated by a blank line. Aggregates only.
 */
export function metricsCsv(o: MetricsOverview, network: StellarNetwork, now: Date): string {
  const summary: Array<Record<"metric" | "value" | "definition", CsvCell>> = [
    { metric: "network", value: network, definition: "The Stellar network this deployment serves." },
    { metric: "generated_at", value: now.toISOString(), definition: "UTC." },
    ...SUMMARY_FIGURES.map((f) => ({ metric: f.label, value: o.summary[f.key], definition: f.definition })),
    { metric: "Profiles with a display name", value: o.withDisplayName, definition: "Users whose profile has a display name." },
    { metric: "Profile completion %", value: profileCompletion(o), definition: "Share of users with a display name." },
  ];
  return [
    section("Summary", ["metric", "value", "definition"], summary),
    section(
      "Weekly",
      ["iso_week", "week_start", "signed_in_wallets", "new_wallets"],
      o.weeks.map((w) => ({ iso_week: w.label, week_start: w.start, signed_in_wallets: w.signedIn, new_wallets: w.newWallets })),
    ),
    section(
      "Campaigns",
      ["campaign", "slug", "submissions", "approved", "paid", "usdc_paid", "link"],
      o.campaigns.map((c) => ({ campaign: c.title, slug: c.slug, submissions: c.submissions, approved: c.approved, paid: c.paid, usdc_paid: c.usdcPaid, link: campaignPath(c.slug) })),
    ),
    section(
      "Countries",
      ["country_code", "country", "users"],
      o.countries.map((c) => ({ country_code: c.country, country: countryName(c.country), users: c.users })),
    ),
  ].join("\r\n");
}
