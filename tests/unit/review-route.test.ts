import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, submissions } from "@/db/schema";
import { FakeDecisionLedger } from "@/ledger/decision-ledger";
import { changeRole } from "@/services/access";
import { makeTestDb } from "./db";

/**
 * POST /api/review and the /review page through their real handlers, with a
 * signed session cookie. Only the database and the decision ledger (the
 * in-memory fake) are swapped.
 */
const world = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  conn: undefined as unknown,
  ledger: undefined as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/wallet/kit", () => ({ login: async () => undefined, logout: async () => undefined, signTransaction: async () => "" }));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("@/escrow", () => ({ getLedger: () => world.ledger }));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", "s".repeat(43));
});

const { POST } = await import("@/app/api/review/route");
const { default: ReviewPage } = await import("@/app/(workspace)/review/page");
const { encodeSession } = await import("@/lib/session");

const ORIGIN = "https://proofwork.test";
const CAMPAIGN = "cmp_1";
const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const THREE_FAIL = { ...ALL_PASS, content_original: false, task_done: false, not_spam: false };

let conn: Db;
let close: () => Promise<void>;
let ledger: FakeDecisionLedger;
/** Fresh keys per test, so the in-memory rate limiter starts empty for each. */
let REVIEWER: string;
let STRANGER: string;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
  ledger = new FakeDecisionLedger();
  world.ledger = ledger;
  REVIEWER = Keypair.random().publicKey();
  STRANGER = Keypair.random().publicKey();
  await changeRole({ pubkey: REVIEWER, role: "reviewer", action: "grant" }, { via: "script" }, conn);
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "camp-1",
    title: "Try Proofwork on testnet",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: Keypair.random().publicKey(),
    disputeResolverPubkey: Keypair.random().publicKey(),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

const signIn = (pubkey: string) => world.jar.set("pw_session", encodeSession(pubkey));

/** A pending submission from a fresh contributor wallet. */
async function submission(id: string, shortId: string): Promise<void> {
  await conn.insert(submissions).values({ id, shortId, campaignId: CAMPAIGN, contributorPubkey: Keypair.random().publicKey(), workUrl: `https://x.com/a/status/${id.replace(/\D/g, "")}` });
}

const body = (over: Record<string, unknown> = {}) => ({
  submissionId: "sub_1",
  signals: ALL_PASS,
  reasonCode: "R00_PASS",
  note: "ok, real task",
  secondsTotal: 30,
  secondsPerSignal: {},
  sharedFundingCount: 0,
  ...over,
});

const send = (payload: unknown) =>
  POST(new Request(`${ORIGIN}/api/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

const page = async () => renderToStaticMarkup((await ReviewPage()) as ReactElement);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("POST /api/review", () => {
  it("records a decision and answers with its on-chain reference", async () => {
    await submission("sub_1", "s1aaaaaa");
    signIn(REVIEWER);
    const res = await send(body());
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["id", "ledgerKey", "outcome", "reasonCode", "txHash"]);
    expect(json).toMatchObject({ outcome: "PASS", reasonCode: "R00_PASS", ledgerKey: "pw:s1aaaaaa" });
    expect(json["txHash"]).toBe(ledger.commits[0]?.txHash);
    expect(json["txHash"]).toMatch(/^fake_/);
    const stored = await conn.select().from(decisions).where(eq(decisions.id, String(json["id"])));
    expect(stored[0]).toMatchObject({ reviewerPubkey: REVIEWER, txHash: json["txHash"] });
    expect((await conn.select().from(submissions).where(eq(submissions.id, "sub_1")))[0]?.status).toBe("decided");
  });

  it.each([
    ["a note under 3 characters", body({ note: "ok" })],
    ["a FAIL without a failed-signal reason", body({ signals: THREE_FAIL, reasonCode: "R00_PASS" })],
    ["a PASS with a fail reason", body({ reasonCode: "R03_TASK" })],
    ["no signals", body({ signals: undefined })],
  ])("answers 400 for %s and commits nothing", async (_name, payload) => {
    await submission("sub_1", "s1aaaaaa");
    signIn(REVIEWER);
    const res = await send(payload);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION" });
    expect(ledger.commits).toHaveLength(0);
    expect(await conn.select().from(decisions)).toHaveLength(0);
  });

  it("answers 401 signed out and 403 for a wallet without the reviewer role", async () => {
    await submission("sub_1", "s1aaaaaa");
    expect((await send(body())).status).toBe(401);
    signIn(STRANGER);
    const res = await send(body());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(ledger.commits).toHaveLength(0);
  });

  it("answers 409 for a submission that was already decided, and commits once", async () => {
    await submission("sub_1", "s1aaaaaa");
    signIn(REVIEWER);
    expect((await send(body())).status).toBe(200);
    const again = await send(body({ signals: THREE_FAIL, reasonCode: "R03_TASK", note: "Tell us one thing you tried." }));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "CONFLICT" });
    expect(ledger.commits).toHaveLength(1);
    expect(await conn.select().from(decisions)).toHaveLength(1);
  });

  it("is rate limited per session wallet: the 121st call in ten minutes answers 429", async () => {
    signIn(REVIEWER);
    const statuses: number[] = [];
    // No such submission: each call is counted, then refused without touching the ledger.
    for (let i = 0; i < 121; i++) statuses.push((await send(body({ submissionId: "sub_missing" }))).status);
    expect(statuses.slice(0, 120)).toEqual(Array<number>(120).fill(404));
    expect(statuses[120]).toBe(429);
    // Another wallet's count is its own.
    await submission("sub_1", "s1aaaaaa");
    const other = Keypair.random().publicKey();
    await changeRole({ pubkey: other, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    signIn(other);
    expect((await send(body())).status).toBe(200);
  });
});

describe("/review page", () => {
  it("asks a signed-out visitor to connect a wallet", async () => {
    const html = await page();
    expect(text(html)).toContain("Connect your Stellar wallet to continue.");
    expect(html).not.toContain("Review queue");
  });

  it("tells a wallet without the reviewer role to ask the operator, and shows no queue", async () => {
    await submission("sub_1", "s1aaaaaa");
    signIn(STRANGER);
    const html = await page();
    expect(text(html)).toContain("Your wallet has no reviewer role.");
    expect(text(html)).toContain("Ask the operator to grant one.");
    expect(html).not.toContain("s1aaaaaa");
    expect(html).not.toContain('aria-label="Rubric"');
  });

  it("shows a reviewer one submission at a time, blind", async () => {
    await submission("sub_1", "s1aaaaaa");
    await submission("sub_2", "s2bbbbbb");
    signIn(REVIEWER);
    const html = await page();
    expect(text(html)).toContain("1 of 2 · 1 waiting");
    expect(html.match(/aria-label="Rubric"/g)).toHaveLength(1);
    expect([html.includes("s1aaaaaa"), html.includes("s2bbbbbb")].filter(Boolean)).toHaveLength(1);
    expect(text(html)).toContain("Record PASS on-chain");
    expect(text(html)).toContain("Skip");
    expect(html).not.toMatch(/G[A-Z2-7]{55}/);
    expect(html).not.toMatch(/planted|suspicious/i);
  });

  it("shows the empty state when nothing is waiting", async () => {
    signIn(REVIEWER);
    const html = await page();
    expect(text(html)).toContain("Nothing to review.");
    expect(text(html)).toContain("New submissions appear here in random order.");
  });
});
