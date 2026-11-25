import { Keypair } from "@stellar/stellar-sdk";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { authNonces, campaigns, decisions, payouts, profiles, submissions, xAccounts } from "@/db/schema";
import { parseCsv } from "@/lib/csv";
import { changeRole } from "@/services/access";
import { makeTestDb } from "./db";

/**
 * Ops metrics: the aggregates against the in-process database, the pure week
 * helpers, the CSV (escaping, sections, no wallet address), and who may read
 * the page and the download.
 */
const world = vi.hoisted(() => ({ jar: new Map<string, string>(), conn: undefined as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
  }),
}));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/admin/metrics",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/wallet/kit", () => ({ login: async () => undefined, logout: async () => undefined, signTransaction: async () => "" }));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", "s".repeat(43));
});

const { GET: csvRoute } = await import("@/app/api/admin/metrics/route");
const { default: MetricsPage } = await import("@/app/(workspace)/admin/metrics/page");
const { WorkspaceNav } = await import("@/components/workspace-nav");
const { encodeSession } = await import("@/lib/session");
const { isoWeekLabel, isoWeekStart, metricsCsv, metricsFilename, metricsOverview, profileCompletion, weekSeries } = await import("@/services/metrics");

const NOW = new Date("2026-11-25T12:00:00Z"); // a Wednesday, ISO week 2026-W48
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const WALLET = /G[A-Z2-7]{55}/;

let conn: Db;
let close: () => Promise<void>;
let OPS: string;
let n = 0;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
  OPS = Keypair.random().publicKey();
  await changeRole({ pubkey: OPS, role: "ops", action: "grant" }, { via: "script" }, conn);
});

afterEach(async () => {
  await close();
});

const wallet = () => Keypair.random().publicKey();
const as = (pubkey: string) => world.jar.set("pw_session", encodeSession(pubkey));

async function signIn(pubkey: string, at: Date): Promise<void> {
  await conn.insert(authNonces).values({ nonce: `n${++n}`, pubkey, expiresAt: new Date(at.getTime() + 300_000), usedAt: at });
}

async function campaign(id: string, funder: string, funded: boolean, title = `Campaign ${id}`, createdAt = NOW): Promise<void> {
  await conn.insert(campaigns).values({
    id,
    slug: `slug-${id}`,
    title,
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(NOW.getTime() + DAY),
    fundedAt: funded ? NOW : null,
    funderPubkey: funder,
    disputeResolverPubkey: wallet(),
    createdAt,
  });
}

async function submission(id: string, campaignId: string, contributor: string): Promise<void> {
  await conn.insert(submissions).values({ id, shortId: id, campaignId, contributorPubkey: contributor, workUrl: `https://x.com/a/status/${++n}` });
}

async function decide(submissionId: string, outcome: "PASS" | "FAIL", appealOf: string | null = null): Promise<string> {
  const id = `d${++n}`;
  await conn.insert(decisions).values({
    id,
    submissionId,
    reviewerPubkey: wallet(),
    outcome,
    reasonCode: outcome === "PASS" ? "R00_PASS" : "R03_TASK",
    signals: {},
    note: "n",
    appealOf,
    canonicalJson: "{}",
    decisionHash: `h${n}`,
    ledgerKey: `k${n}`,
  });
  return id;
}

async function payout(submissionId: string, amount: string, status: "released" | "approved", txHash: string | null = status === "released" ? `tx${++n}` : null): Promise<void> {
  await conn.insert(payouts).values({ id: `p${++n}`, submissionId, amount, status, releaseTxHash: txHash });
}

describe("week helpers", () => {
  it("buckets a date into its ISO week, Monday to Sunday, in UTC", () => {
    expect(isoWeekStart(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23"); // Monday
    expect(isoWeekStart(new Date("2026-11-29T23:59:59Z"))).toBe("2026-11-23"); // Sunday
    expect(isoWeekStart(new Date("2026-11-30T00:00:00Z"))).toBe("2026-11-30");
    expect(isoWeekStart(new Date("2027-01-01T10:00:00Z"))).toBe("2026-12-28");
  });

  it("labels the week by the year of its Thursday", () => {
    expect(isoWeekLabel("2026-11-23")).toBe("2026-W48");
    expect(isoWeekLabel("2026-12-28")).toBe("2026-W53");
    expect(isoWeekLabel("2027-01-04")).toBe("2027-W01");
    expect(isoWeekLabel("2025-12-29")).toBe("2026-W01");
  });

  it("fills the weeks between the first one and now with zeros", () => {
    const rows = weekSeries([{ week: "2026-11-02", n: 3 }, { week: "2026-11-16", n: 1 }], [{ week: "2026-11-02", n: 3 }], NOW);
    expect(rows).toEqual([
      { start: "2026-11-02", label: "2026-W45", signedIn: 3, newWallets: 3 },
      { start: "2026-11-09", label: "2026-W46", signedIn: 0, newWallets: 0 },
      { start: "2026-11-16", label: "2026-W47", signedIn: 1, newWallets: 0 },
      { start: "2026-11-23", label: "2026-W48", signedIn: 0, newWallets: 0 },
    ]);
    expect(weekSeries([], [], NOW)).toEqual([]);
  });
});

describe("metricsOverview", () => {
  it("is all zeros and empty lists on an empty database", async () => {
    const o = await metricsOverview({ pubkey: OPS }, conn, NOW);
    expect(o.summary).toEqual({ users: 0, active1d: 0, active7d: 0, active30d: 0, xVerified: 0, contributors: 0, approved: 0, paidUsers: 0, usdcPaid: "0", funders: 0 });
    expect(o).toMatchObject({ withDisplayName: 0, weeks: [], campaigns: [], countries: [] });
    expect(profileCompletion(o)).toBe(0);
  });

  it("counts a wallet that signs in five times in a day once, in users and in that day's active count", async () => {
    const a = wallet();
    for (let i = 0; i < 5; i++) await signIn(a, new Date(NOW.getTime() - (i + 1) * 3_600_000));
    // A challenge that was never signed is not a sign-in.
    await conn.insert(authNonces).values({ nonce: "unused", pubkey: wallet(), expiresAt: NOW, usedAt: null });
    const o = await metricsOverview({ pubkey: OPS }, conn, NOW);
    expect(o.summary).toMatchObject({ users: 1, active1d: 1, active7d: 1, active30d: 1 });
    expect(o.weeks).toEqual([{ start: "2026-11-23", label: "2026-W48", signedIn: 1, newWallets: 1 }]);
  });

  it("splits active wallets by window and buckets the weekly series by ISO week in SQL", async () => {
    const [a, b, c] = [wallet(), wallet(), wallet()];
    await signIn(a, ago(0.5));
    await signIn(b, ago(3)); // Sunday 2026-11-22, week 47
    await signIn(c, ago(20)); // week 45
    await signIn(c, ago(2.4)); // Monday 2026-11-23 02:24, week 48
    const o = await metricsOverview({ pubkey: OPS }, conn, NOW);
    expect(o.summary).toMatchObject({ users: 3, active1d: 1, active7d: 3, active30d: 3 });
    expect(o.weeks).toEqual([
      { start: "2026-11-02", label: "2026-W45", signedIn: 1, newWallets: 1 },
      { start: "2026-11-09", label: "2026-W46", signedIn: 0, newWallets: 0 },
      { start: "2026-11-16", label: "2026-W47", signedIn: 1, newWallets: 1 },
      { start: "2026-11-23", label: "2026-W48", signedIn: 2, newWallets: 1 },
    ]);
  });

  it("counts contributors, approvals, released payouts, funders, X links and profiles as defined", async () => {
    const [f1, f2, u1, u2, u3] = [wallet(), wallet(), wallet(), wallet(), wallet()];
    for (const w of [f1, u1, u2, u3]) await signIn(w, ago(0.9));
    await campaign("c1", f1, true, "Older", ago(5));
    await campaign("c2", f1, true, "Newer", ago(1));
    await campaign("c3", f2, false, "Draft", ago(9));
    await submission("s1", "c1", u1);
    await submission("s2", "c1", u2);
    await submission("s3", "c2", u1);
    await submission("s4", "c2", u3);
    await decide("s1", "PASS");
    const fail = await decide("s2", "FAIL");
    await decide("s2", "PASS", fail); // overturned on appeal: one approval
    await decide("s3", "PASS");
    await decide("s4", "FAIL");
    await payout("s1", "5.5", "released");
    await payout("s2", "5", "approved");
    await payout("s3", "10", "released");
    await conn.insert(xAccounts).values([{ pubkey: u1, xUserId: "1" }, { pubkey: u2, xUserId: "2" }]);
    await conn.insert(profiles).values([
      { pubkey: u1, displayName: "Ada", country: "TR", telegram: "ada_writes" },
      { pubkey: u2, displayName: "Bo", country: "TR" },
      { pubkey: u3, displayName: null, country: "DE" },
    ]);

    const o = await metricsOverview({ pubkey: OPS }, conn, NOW);
    expect(o.summary).toEqual({ users: 4, active1d: 4, active7d: 4, active30d: 4, xVerified: 2, contributors: 3, approved: 3, paidUsers: 1, usdcPaid: "15.5", funders: 1 });
    expect(o.withDisplayName).toBe(2);
    expect(profileCompletion(o)).toBe(50);
    expect(o.campaigns).toEqual([
      { slug: "slug-c2", title: "Newer", submissions: 2, approved: 1, paid: 1, usdcPaid: "10" },
      { slug: "slug-c1", title: "Older", submissions: 2, approved: 2, paid: 1, usdcPaid: "5.5" },
      { slug: "slug-c3", title: "Draft", submissions: 0, approved: 0, paid: 0, usdcPaid: "0" },
    ]);
    expect(o.countries).toEqual([
      { country: "TR", users: 2 },
      { country: "DE", users: 1 },
      { country: null, users: 1 },
    ]);
  });

  it("does not count a released status without its release transaction as paid", async () => {
    const [f, u] = [wallet(), wallet()];
    await campaign("c1", f, true);
    await submission("s1", "c1", u);
    await payout("s1", "5", "released", null);
    const o = await metricsOverview({ pubkey: OPS }, conn, NOW);
    expect(o.summary).toMatchObject({ paidUsers: 0, usdcPaid: "0" });
    expect(o.campaigns[0]).toMatchObject({ paid: 0, usdcPaid: "0" });
  });

  it("refuses a wallet without ops, and an ops grant scoped to one campaign", async () => {
    const other = wallet();
    await expect(metricsOverview({ pubkey: other }, conn, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await campaign("c1", wallet(), true);
    await changeRole({ pubkey: other, role: "ops", action: "grant", campaignId: "c1" }, { via: "script" }, conn);
    await expect(metricsOverview({ pubkey: other }, conn, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("metricsCsv", () => {
  async function seeded(title: string) {
    const [f, u] = [wallet(), wallet()];
    await signIn(u, ago(1));
    await signIn(f, ago(2));
    await campaign("c1", f, true, title);
    await submission("s1", "c1", u);
    await decide("s1", "PASS");
    await payout("s1", "2.5", "released");
    await conn.insert(xAccounts).values({ pubkey: u, xUserId: "1" });
    await conn.insert(profiles).values({ pubkey: u, displayName: "Ada", country: "TR", telegram: "ada_writes", city: "Izmir", bio: "bio" });
    return metricsOverview({ pubkey: OPS }, conn, NOW);
  }

  /** The file's sections by title: each a header and rows, as a spreadsheet would read them. */
  function sections(csv: string): Map<string, ReturnType<typeof parseCsv>> {
    const out = new Map<string, ReturnType<typeof parseCsv>>();
    for (const block of csv.split("\r\n\r\n")) {
      const [title, ...rest] = block.split("\r\n");
      out.set(title as string, parseCsv(rest.join("\r\n")));
    }
    return out;
  }

  it("has the summary, weekly, campaigns and countries sections", async () => {
    const csv = metricsCsv(await seeded("Launch week"), "testnet", NOW);
    const s = sections(csv);
    expect([...s.keys()]).toEqual(["Summary", "Weekly", "Campaigns", "Countries"]);
    const summary = new Map(s.get("Summary")?.rows.map((r) => [r["metric"], r["value"]]));
    expect(summary.get("network")).toBe("testnet");
    expect(summary.get("Users")).toBe("2");
    expect(summary.get("USDC paid")).toBe("2.5");
    expect(summary.get("Profile completion %")).toBe("50");
    expect(s.get("Weekly")?.rows).toEqual([{ iso_week: "2026-W48", week_start: "2026-11-23", signed_in_wallets: "2", new_wallets: "2" }]);
    expect(s.get("Campaigns")?.rows).toEqual([{ campaign: "Launch week", slug: "slug-c1", submissions: "1", approved: "1", paid: "1", usdc_paid: "2.5", link: "/c/slug-c1" }]);
    expect(s.get("Countries")?.rows).toEqual([
      { country_code: "TR", country: "Türkiye", users: "1" },
      { country_code: "", country: "not given", users: "1" },
    ]);
  });

  it("escapes quotes, commas and newlines, and defuses a formula", async () => {
    const csv = metricsCsv(await seeded('=HYPERLINK("http://evil"), "launch"\nweek'), "testnet", NOW);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil""), ""launch""\nweek"`);
    expect(sections(csv).get("Campaigns")?.rows[0]?.["campaign"]).toBe(`'=HYPERLINK("http://evil"), "launch"\nweek`);
  });

  it("holds no wallet address and no contact field", async () => {
    const csv = metricsCsv(await seeded("Launch week"), "testnet", NOW);
    expect(csv).not.toMatch(WALLET);
    expect(csv).not.toContain(OPS);
    for (const contact of ["ada_writes", "Izmir", "Ada"]) expect(csv).not.toContain(contact);
  });

  it("names the file after the network and the date", () => {
    expect(metricsFilename("mainnet", NOW)).toBe("proofwork-metrics-mainnet-2026-11-25.csv");
  });
});

describe("the CSV download", () => {
  it("is 401 without a session and 403 for a wallet without ops", async () => {
    expect((await csvRoute()).status).toBe(401);
    as(wallet());
    expect((await csvRoute()).status).toBe(403);
  });

  it("is an uncached attachment for ops", async () => {
    as(OPS);
    const res = await csvRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="proofwork-metrics-testnet-\d{4}-\d{2}-\d{2}\.csv"$/);
    const text = await res.text();
    expect(text).toContain("Summary\r\nmetric,value,definition");
    expect(text).not.toMatch(WALLET);
  });
});

describe("the metrics page", () => {
  const render = async () => renderToStaticMarkup((await MetricsPage()) as ReactElement);

  it("is a 404 for a wallet without ops and asks a visitor to connect", async () => {
    expect(await render()).toContain("Connect your Stellar wallet");
    as(wallet());
    await expect(MetricsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the figures, their definitions and an empty-state line per table on an empty database", async () => {
    as(OPS);
    const html = await render();
    expect(html).toContain("Download CSV");
    expect(html).toContain('href="/api/admin/metrics"');
    expect(html).toContain("Distinct wallets with a used sign-in nonce.");
    expect(html).toContain("No campaigns yet.");
    // Ops signed in through a session cookie only, so there is no sign-in nonce yet.
    expect(html).toContain("No sign-ins yet.");
    expect(html).toContain("No users yet.");
  });

  it("shows the weekly chart, the campaigns with a link and the countries, without any wallet address", async () => {
    const [f, u] = [wallet(), wallet()];
    await signIn(u, ago(1));
    await campaign("c1", f, true, "Launch week");
    await submission("s1", "c1", u);
    await conn.insert(profiles).values({ pubkey: u, displayName: "Ada", country: "TR", telegram: "ada_writes" });
    as(OPS);
    const html = await render();
    expect(html).toContain("<svg");
    expect(html).toContain("2026-W");
    expect(html).toContain('href="/c/slug-c1"');
    expect(html).toContain("Türkiye");
    expect(html).not.toContain("ada_writes");
    expect(html.replace(OPS, "")).not.toMatch(WALLET);
  });
});

describe("the Metrics nav item", () => {
  it("is listed after Admin for ops and marks itself, not Admin, on its page", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { campaigns: null, reviewer: false, admin: true, metrics: true, variant: "side" }));
    expect(html).toMatch(/href="\/admin".*href="\/admin\/metrics"/);
    expect(html).toMatch(/href="\/admin\/metrics" aria-current="page"/);
    expect(html).not.toMatch(/href="\/admin" aria-current="page"/);
  });

  it("is left out for a wallet that sees Admin only as a dispute resolver", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { campaigns: null, reviewer: false, admin: true, variant: "side" }));
    expect(html).not.toContain('href="/admin/metrics"');
  });
});
