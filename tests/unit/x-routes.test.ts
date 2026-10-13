import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { sessionRevocations, xAccounts } from "@/db/schema";
import { FakeX } from "@/x/fake";
import type { XPort } from "@/x/port";
import { makeTestDb } from "./db";

/** The browser's cookie jar, as `cookies()` from next/headers reads and writes it. */
interface SetCall {
  name: string;
  value: string;
  options: { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number };
}
const world = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as SetCall[],
  conn: undefined as unknown,
  x: null as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
    set: (name: string, value: string, options: SetCall["options"] = {}) => {
      world.sets.push({ name, value, options });
      // A browser drops a cookie set with Max-Age=0.
      if (options.maxAge === 0) world.jar.delete(name);
      else world.jar.set(name, value);
    },
  }),
}));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("@/x", () => ({ getX: () => world.x }));

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

const { GET: connect } = await import("@/app/api/x/connect/route");
const { GET: callback } = await import("@/app/api/x/callback/route");
const { encodeSession } = await import("@/lib/session");

const WALLET_A = Keypair.random().publicKey();
const WALLET_B = Keypair.random().publicKey();
const SLUG = "camp-1";
const ORIGIN = "https://proofwork.test";
// Recognisable stand-in, so a leak into a log line is easy to assert on.
const CODE = "code.sentinel.1";

let conn: Db;
let close: () => Promise<void>;
let x: FakeX;
let ip = 0;
let clientIp: string;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
  world.sets = [];
  x = new FakeX();
  x.approveAs("111");
  world.x = x;
  // A fresh address per test, so the in-memory rate limiter starts empty.
  clientIp = `203.0.113.${++ip}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

function signIn(wallet: string): void {
  world.jar.set("pw_session", encodeSession(wallet));
}

function get(handler: (req: Request) => Promise<Response>, pathAndQuery: string): Promise<Response> {
  return handler(new Request(`${ORIGIN}${pathAndQuery}`, { headers: { "x-forwarded-for": clientIp } }));
}

/** Follows the connect redirect the way X would on approval: back to the callback with the same state. */
async function startAndApprove(): Promise<string> {
  const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
  const state = new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? "";
  return `/api/x/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(CODE)}`;
}

function captureLogs(): () => string {
  const lines: string[] = [];
  const keep = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(keep);
  vi.spyOn(process.stderr, "write").mockImplementation(keep);
  return () => lines.join("");
}

describe("GET /api/x/connect", () => {
  it("redirects a signed-in wallet to X and sets the flow cookie for the X routes only", async () => {
    signIn(WALLET_A);
    const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/^https:\/\/x\.test\/authorize\?state=/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(world.sets).toHaveLength(1);
    expect(world.sets[0]).toMatchObject({ name: "pw_x_flow", options: { httpOnly: true, sameSite: "lax", path: "/api/x" } });
    expect(world.sets[0]?.options.maxAge).toBeGreaterThan(0);
  });

  it("returns to the campaign page with a sign-in message without a wallet session", async () => {
    const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=signin`);
    expect(world.sets).toEqual([]);
  });

  it("treats a session revoked by logout as signed out", async () => {
    signIn(WALLET_A);
    await conn.insert(sessionRevocations).values({ pubkey: WALLET_A, revokedBefore: new Date(Date.now() + 60_000) });
    const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=signin`);
  });

  it("does not redirect to X when X is not configured", async () => {
    world.x = null satisfies XPort | null;
    signIn(WALLET_A);
    const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=unavailable`);
    expect(world.sets).toEqual([]);
  });

  it.each(["", "?slug=", "?slug=https://evil.test", "?slug=a/b", "?slug=//evil.test", "?next=/c/camp-1"])(
    "answers 400 and redirects nowhere for %j",
    async (query) => {
      signIn(WALLET_A);
      const res = await get(connect, `/api/x/connect${query}`);
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(world.sets).toEqual([]);
    },
  );

  it("is rate limited per address and wallet", async () => {
    signIn(WALLET_A);
    for (let i = 0; i < 10; i++) {
      const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
      expect(res.headers.get("location")).toMatch(/^https:\/\/x\.test\//);
    }
    const res = await get(connect, `/api/x/connect?slug=${SLUG}`);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=rate_limited`);
  });
});

describe("GET /api/x/callback", () => {
  it("binds the session wallet and returns to the campaign page as connected", async () => {
    signIn(WALLET_A);
    const res = await get(callback, await startAndApprove());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=connected`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await conn.select().from(xAccounts)).toMatchObject([{ pubkey: WALLET_A, xUserId: "111" }]);
  });

  it("spends the flow cookie: the same callback opened again binds nothing and does not call X", async () => {
    signIn(WALLET_A);
    const url = await startAndApprove();
    await get(callback, url);
    expect(world.jar.has("pw_x_flow")).toBe(false);
    expect(world.sets.at(-1)).toMatchObject({ name: "pw_x_flow", value: "", options: { path: "/api/x", maxAge: 0 } });

    const again = await get(callback, url);
    expect(again.headers.get("location")).toBe("/explore");
    expect(x.identified).toHaveLength(1);
    expect(await conn.select().from(xAccounts)).toHaveLength(1);
  });

  it("spends the flow cookie on a failed attempt too", async () => {
    signIn(WALLET_A);
    x.failNext();
    const url = await startAndApprove();
    const first = await get(callback, url);
    expect(first.headers.get("location")).toBe(`/c/${SLUG}?x=x_failed`);
    x.approveAs("111");
    await get(callback, url);
    expect(x.identified).toHaveLength(1);
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("returns as cancelled when the contributor denied on X", async () => {
    signIn(WALLET_A);
    const approved = new URL(`${ORIGIN}${await startAndApprove()}`);
    const res = await get(callback, `/api/x/callback?state=${encodeURIComponent(approved.searchParams.get("state") ?? "")}&error=access_denied`);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=cancelled`);
    expect(x.identified).toEqual([]);
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("binds nothing when another wallet is signed in by the time X sends the contributor back", async () => {
    signIn(WALLET_A);
    const url = await startAndApprove();
    signIn(WALLET_B);
    const res = await get(callback, url);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=retry`);
    expect(x.identified).toEqual([]);
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("binds nothing without a wallet session and asks to sign in", async () => {
    signIn(WALLET_A);
    const url = await startAndApprove();
    world.jar.delete("pw_session");
    const res = await get(callback, url);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=signin`);
    expect(x.identified).toEqual([]);
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("refuses a query that fails the schema as bad state", async () => {
    signIn(WALLET_A);
    const url = await startAndApprove();
    const res = await get(callback, `${url}&error=${"e".repeat(101)}`);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=retry`);
    expect(x.identified).toEqual([]);
  });

  it("logs no code, state or flow cookie when X fails", async () => {
    signIn(WALLET_A);
    x.failNext();
    const url = await startAndApprove();
    const flowCookie = world.jar.get("pw_x_flow") ?? "";
    const state = new URL(`${ORIGIN}${url}`).searchParams.get("state") ?? "";
    const logs = captureLogs();
    await get(callback, url);
    const text = logs();
    expect(text).toContain("x did not identify the account");
    for (const leak of [CODE, state, flowCookie]) expect(text).not.toContain(leak);
  });

  it("is rate limited, and still returns to the campaign the cookie names", async () => {
    signIn(WALLET_A);
    for (let i = 0; i < 10; i++) await get(callback, "/api/x/callback?state=nope&code=nope");
    const url = await startAndApprove();
    const res = await get(callback, url);
    expect(res.headers.get("location")).toBe(`/c/${SLUG}?x=rate_limited`);
    expect(x.identified).toEqual([]);
    expect(world.jar.has("pw_x_flow")).toBe(false);
  });
});
