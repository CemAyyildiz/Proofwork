import { createHash, createHmac } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { xAccounts } from "@/db/schema";
import { XApi } from "@/x/api";
import { FakeX } from "@/x/fake";
import { makeTestDb } from "./db";
import { fakeFetch, type FakeReply } from "./fake-fetch";

const SESSION_KEY = "s".repeat(43);

// The flow cookie is signed with SESSION_SECRET, so the service needs a parsed environment.
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", SESSION_KEY);
});

const { bindXAccount, createFlow, finishConnect, flowSlug, startConnect, verifyFlow, xAccountFor, FLOW_TTL_SECONDS } = await import(
  "@/services/x-account"
);
const { decodeSession, encodeSession } = await import("@/lib/session");

const WALLET_A = Keypair.random().publicKey();
const WALLET_B = Keypair.random().publicKey();
const SLUG = "camp-1_a-";
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
// Recognisable stand-in, so a leak into a log line is easy to assert on.
const CODE = "code.sentinel.1";

let conn: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

/** What a flow cookie holds, read the way only a test may: without checking anything. */
function peek(token: string): { st: string; cv: string; pk: string; slug: string; exp: number } {
  return JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"));
}

/** Everything written to stdout and stderr from here on. */
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

describe("bindXAccount", () => {
  it("stores the wallet, the X account ID and a timestamp, and nothing else", async () => {
    await bindXAccount(WALLET_A, "111", conn);
    const rows = await conn.select().from(xAccounts);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["connectedAt", "pubkey", "xUserId"]);
    expect(rows[0]).toMatchObject({ pubkey: WALLET_A, xUserId: "111" });
    expect(rows[0]?.connectedAt).toBeInstanceOf(Date);
  });

  it("succeeds without a second row when the same pair connects again", async () => {
    await bindXAccount(WALLET_A, "111", conn);
    const first = await conn.select().from(xAccounts);
    await expect(bindXAccount(WALLET_A, "111", conn)).resolves.toBeUndefined();
    expect(await conn.select().from(xAccounts)).toEqual(first);
  });

  it("refuses an X account that another wallet holds and stores nothing for the second wallet", async () => {
    await bindXAccount(WALLET_A, "111", conn);
    await expect(bindXAccount(WALLET_B, "111", conn)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "x_taken" } });
    expect(await xAccountFor(WALLET_B, conn)).toBeNull();
    expect(await conn.select().from(xAccounts)).toHaveLength(1);
  });

  it("refuses a second X account for a wallet and keeps the first", async () => {
    await bindXAccount(WALLET_A, "111", conn);
    await expect(bindXAccount(WALLET_A, "222", conn)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "wallet_bound" } });
    expect(await xAccountFor(WALLET_A, conn)).toMatchObject({ xUserId: "111" });
    expect(await conn.select().from(xAccounts)).toHaveLength(1);
  });

  it("lets only one of two racing wallets take an X account", async () => {
    const results = await Promise.allSettled([bindXAccount(WALLET_A, "111", conn), bindXAccount(WALLET_B, "111", conn)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await conn.select().from(xAccounts)).toHaveLength(1);
  });

  it("rejects anything that is not a numeric X account ID or a wallet key", async () => {
    for (const id of ["deniz_k", "", "0", "0111", "1".repeat(20), " 111", "111\n"]) await expect(bindXAccount(WALLET_A, id, conn)).rejects.toThrow();
    await expect(bindXAccount(WALLET_A, "1".repeat(19), conn)).resolves.toBeUndefined();
    await conn.delete(xAccounts);
    await expect(bindXAccount("not-a-wallet", "111", conn)).rejects.toThrow();
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("has both uniqueness rules in the database itself", async () => {
    await conn.insert(xAccounts).values({ pubkey: WALLET_A, xUserId: "111" });
    await expect(conn.insert(xAccounts).values({ pubkey: WALLET_B, xUserId: "111" })).rejects.toThrow();
    await expect(conn.insert(xAccounts).values({ pubkey: WALLET_A, xUserId: "222" })).rejects.toThrow();
  });
});

describe("what the database can hold from X", () => {
  /** `Db` does not type raw results; PGlite answers `{ rows }`. */
  async function columns(where: ReturnType<typeof sql>): Promise<Array<{ table_name: string; column_name: string }>> {
    const result = (await conn.execute(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and ${where} order by table_name, column_name`,
    )) as unknown as { rows: Array<{ table_name: string; column_name: string }> };
    return result.rows;
  }

  it("is the x_account row alone: wallet, account ID, timestamp", async () => {
    const own = await columns(sql`table_name = 'x_account'`);
    expect(own.map((r) => r.column_name)).toEqual(["connected_at", "pubkey", "x_user_id"]);
  });

  it("has no column for a token, a handle, a name or a verifier in any table", async () => {
    const suspect = await columns(sql`column_name ~* '(^x_|oauth|token|handle|username|screen_name|display_name|verifier|access|refresh)'`);
    // payout_lock_token is the Month 1 payout lease, not an X token.
    expect(suspect).toEqual([
      { table_name: "campaign", column_name: "payout_lock_token" },
      { table_name: "x_account", column_name: "x_user_id" },
    ]);
  });
});

describe("flow state", () => {
  it("round-trips for the wallet and state it was issued to", () => {
    const flow = createFlow(WALLET_A, SLUG, NOW);
    const held = peek(flow.token);
    expect(verifyFlow(flow.token, { pubkey: WALLET_A, state: flow.state }, NOW + 1_000)).toEqual({ codeVerifier: held.cv });
    expect(flowSlug(flow.token)).toBe(SLUG);
  });

  it("derives the challenge from the verifier with S256 and never repeats a state or verifier", () => {
    const a = createFlow(WALLET_A, SLUG, NOW);
    const b = createFlow(WALLET_A, SLUG, NOW);
    expect(a.codeChallenge).toBe(createHash("sha256").update(peek(a.token).cv).digest("base64url"));
    // RFC 7636: the verifier is 43 to 128 characters.
    expect(peek(a.token).cv).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a.state).not.toBe(b.state);
    expect(peek(a.token).cv).not.toBe(peek(b.token).cv);
  });

  it("expires 10 minutes after it was issued", () => {
    const flow = createFlow(WALLET_A, SLUG, NOW);
    expect(FLOW_TTL_SECONDS).toBe(600);
    const expected = { pubkey: WALLET_A, state: flow.state };
    expect(verifyFlow(flow.token, expected, NOW + 599_000)).not.toBeNull();
    expect(verifyFlow(flow.token, expected, NOW + 600_000)).toBeNull();
  });

  it("refuses another wallet, another state and a missing state", () => {
    const flow = createFlow(WALLET_A, SLUG, NOW);
    expect(verifyFlow(flow.token, { pubkey: WALLET_B, state: flow.state }, NOW)).toBeNull();
    expect(verifyFlow(flow.token, { pubkey: WALLET_A, state: createFlow(WALLET_A, SLUG, NOW).state }, NOW)).toBeNull();
    expect(verifyFlow(flow.token, { pubkey: WALLET_A, state: undefined }, NOW)).toBeNull();
    expect(verifyFlow(flow.token, { pubkey: WALLET_A, state: "" }, NOW)).toBeNull();
  });

  it("refuses a cookie that was edited, re-signed by nobody, or is missing", () => {
    const flow = createFlow(WALLET_A, SLUG, NOW);
    const [body = "", sig = ""] = flow.token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...peek(flow.token), pk: WALLET_B })).toString("base64url");
    for (const token of [undefined, "", "garbage", `${forged}.${sig}`, `${body}.${sig.slice(0, -2)}xx`, `${body}.${sig}.extra`, body]) {
      expect(verifyFlow(token, { pubkey: WALLET_A, state: flow.state }, NOW)).toBeNull();
      expect(verifyFlow(token, { pubkey: WALLET_B, state: flow.state }, NOW)).toBeNull();
    }
    expect(flowSlug(`${forged}.${sig}`)).toBeNull();
  });

  it("is signed apart from the session cookie: neither verifies as the other", () => {
    const flow = createFlow(WALLET_A, SLUG, NOW);
    expect(decodeSession(flow.token, NOW)).toBeNull();
    const session = encodeSession(WALLET_A, NOW);
    expect(flowSlug(session)).toBeNull();
    // A flow body signed the way the session cookie is signed: the shape is right, the key is not.
    const [body = ""] = flow.token.split(".");
    const underSessionKey = createHmac("sha256", SESSION_KEY).update(body).digest("base64url");
    expect(flowSlug(`${body}.${underSessionKey}`)).toBeNull();
    expect(verifyFlow(`${body}.${underSessionKey}`, { pubkey: WALLET_A, state: flow.state }, NOW)).toBeNull();
  });

  it("only returns to a campaign slug, never a URL or a path", () => {
    for (const slug of ["https://evil.test", "//evil.test", "a/b", "a?x=1", "..", "", "a".repeat(81)]) {
      expect(() => createFlow(WALLET_A, slug, NOW)).toThrow();
    }
  });
});

describe("flow cookie", () => {
  /** The environment is parsed once per module instance, so each case loads its own. */
  async function optionsUnder(nodeEnv: string) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", nodeEnv);
    try {
      return (await import("@/services/x-account")).flowCookieOptions();
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  }

  it("is Secure in production and only there", async () => {
    expect((await optionsUnder("production")).secure).toBe(true);
    expect((await optionsUnder("development")).secure).toBe(false);
    expect((await optionsUnder("test")).secure).toBe(false);
  });

  it("is httpOnly, SameSite=Lax and sent only to the X routes", async () => {
    expect(await optionsUnder("production")).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/x" });
  });
});

describe("startConnect", () => {
  it("sends a signed-in wallet to X with a state and challenge that match the cookie", () => {
    const x = new FakeX();
    const started = startConnect({ pubkey: WALLET_A, slug: SLUG, x, now: NOW });
    if (started.to !== "x") throw new Error("expected a redirect to X");
    const url = new URL(started.url);
    const held = peek(started.flowToken);
    expect(url.origin).toBe("https://x.test");
    expect(url.searchParams.get("state")).toBe(held.st);
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(held.cv).digest("base64url"));
    expect(held).toMatchObject({ pk: WALLET_A, slug: SLUG, exp: NOW / 1000 + 600 });
    // The verifier stays in the cookie; only its hash goes to X.
    expect(started.url).not.toContain(held.cv);
  });

  it("does not go to X without a wallet session", () => {
    expect(startConnect({ pubkey: null, slug: SLUG, x: new FakeX(), now: NOW })).toEqual({ to: "campaign", outcome: "signin" });
  });

  it("does not go to X when X is not configured", () => {
    expect(startConnect({ pubkey: WALLET_A, slug: SLUG, x: null, now: NOW })).toEqual({ to: "campaign", outcome: "unavailable" });
  });
});

describe("finishConnect", () => {
  /** A started flow for `wallet`, and the callback query X would send on approval. */
  function approved(wallet: string, x: FakeX, now = NOW) {
    const started = startConnect({ pubkey: wallet, slug: SLUG, x, now });
    if (started.to !== "x") throw new Error("expected a redirect to X");
    const state = new URL(started.url).searchParams.get("state") ?? "";
    return { flowToken: started.flowToken, state, query: { state, code: CODE } };
  }

  it("binds the wallet to the account X names", async () => {
    const x = new FakeX();
    x.approveAs("111");
    const flow = approved(WALLET_A, x);
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "connected" });
    expect(await conn.select().from(xAccounts)).toMatchObject([{ pubkey: WALLET_A, xUserId: "111" }]);
    expect(x.identified).toEqual([{ code: CODE, codeVerifier: peek(flow.flowToken).cv }]);
  });

  it("succeeds with still one row when the same pair connects again", async () => {
    const x = new FakeX();
    x.approveAs("111");
    for (let i = 0; i < 2; i++) {
      const flow = approved(WALLET_A, x);
      const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
      expect(out.outcome).toBe("connected");
    }
    expect(await conn.select().from(xAccounts)).toHaveLength(1);
  });

  it("says the X account is taken and stores nothing for the second wallet", async () => {
    const x = new FakeX();
    x.approveAs("111");
    await bindXAccount(WALLET_A, "111", conn);
    const flow = approved(WALLET_B, x);
    const out = await finishConnect({ pubkey: WALLET_B, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "taken" });
    expect(await conn.select().from(xAccounts)).toMatchObject([{ pubkey: WALLET_A, xUserId: "111" }]);
  });

  it("says the wallet is already bound and keeps the first account", async () => {
    const x = new FakeX();
    await bindXAccount(WALLET_A, "111", conn);
    x.approveAs("222");
    const flow = approved(WALLET_A, x);
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "wallet_bound" });
    expect(await conn.select().from(xAccounts)).toMatchObject([{ pubkey: WALLET_A, xUserId: "111" }]);
  });

  it("stores nothing and does not call X when the contributor denied on X", async () => {
    const x = new FakeX();
    x.approveAs("111");
    const flow = approved(WALLET_A, x);
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: { state: flow.state, error: "access_denied" }, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "cancelled" });
    expect(x.identified).toEqual([]);
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it.each([
    ["server_error", "server_error"],
    ["invalid_scope", "invalid_scope"],
    ["made.up.sentinel", "other"],
  ])("treats the authorize error %s as X failing, without calling X, and logs it as %s", async (error, logged) => {
    const x = new FakeX();
    x.approveAs("111");
    const flow = approved(WALLET_A, x);
    const logs = captureLogs();
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: { state: flow.state, error, code: CODE }, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "x_failed" });
    expect(x.identified).toEqual([]);

    const lines = logs().trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "warn", msg: "x refused the authorization", error: logged });
    for (const leak of ["made.up.sentinel", CODE, flow.state]) expect(lines[0]).not.toContain(leak);
  });

  it("leaves one log line per bind with the wallet and the outcome, never the X account ID", async () => {
    const x = new FakeX();
    const logs = captureLogs();
    const attempt = async (wallet: string, account: string) => {
      x.approveAs(account);
      const flow = approved(wallet, x);
      return (await finishConnect({ pubkey: wallet, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW })).outcome;
    };
    expect(await attempt(WALLET_A, "7770001")).toBe("connected");
    expect(await attempt(WALLET_B, "7770001")).toBe("taken");
    expect(await attempt(WALLET_A, "7770002")).toBe("wallet_bound");

    const lines = logs().trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toMatchObject([
      { level: "info", msg: "x account bind", wallet: WALLET_A, outcome: "connected" },
      { level: "info", msg: "x account bind", wallet: WALLET_B, outcome: "taken" },
      { level: "info", msg: "x account bind", wallet: WALLET_A, outcome: "wallet_bound" },
    ]);
    expect(logs()).not.toContain("777000");
  });

  describe("bad state", () => {
    const cases: Array<[string, (flow: { flowToken: string; state: string }) => { pubkey: string; flowToken: string | undefined; query: { state?: string; code?: string }; now?: number }]> = [
      ["state missing from the callback", (f) => ({ pubkey: WALLET_A, flowToken: f.flowToken, query: { code: CODE } })],
      ["state that does not match", (f) => ({ pubkey: WALLET_A, flowToken: f.flowToken, query: { state: `${f.state}x`, code: CODE } })],
      ["an expired flow", (f) => ({ pubkey: WALLET_A, flowToken: f.flowToken, query: { state: f.state, code: CODE }, now: NOW + 600_000 })],
      ["a flow issued to another wallet", (f) => ({ pubkey: WALLET_B, flowToken: f.flowToken, query: { state: f.state, code: CODE } })],
      ["no code and no error", (f) => ({ pubkey: WALLET_A, flowToken: f.flowToken, query: { state: f.state } })],
    ];

    it.each(cases)("stores nothing, does not call X and asks to try again: %s", async (_label, build) => {
      const x = new FakeX();
      x.approveAs("111");
      const input = build(approved(WALLET_A, x));
      const out = await finishConnect({ now: NOW, ...input, x, conn });
      expect(out).toEqual({ slug: SLUG, outcome: "retry" });
      expect(x.identified).toEqual([]);
      expect(await conn.select().from(xAccounts)).toHaveLength(0);
    });

    it.each([
      ["no flow cookie", undefined],
      ["a flow cookie this server did not sign", "e30.bm90LWEtc2lnbmF0dXJl"],
    ])("has no campaign to return to with %s", async (_label, flowToken) => {
      const x = new FakeX();
      x.approveAs("111");
      const { state } = approved(WALLET_A, x);
      const out = await finishConnect({ pubkey: WALLET_A, flowToken, query: { state, code: CODE }, x, conn, now: NOW });
      expect(out).toEqual({ slug: null, outcome: "retry" });
      expect(x.identified).toEqual([]);
      expect(await conn.select().from(xAccounts)).toHaveLength(0);
    });
  });

  it("stores nothing and does not call X without a wallet session", async () => {
    const x = new FakeX();
    x.approveAs("111");
    const flow = approved(WALLET_A, x);
    const out = await finishConnect({ pubkey: null, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "signin" });
    expect(x.identified).toEqual([]);
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("stores nothing when X is not configured by the time the callback arrives", async () => {
    const flow = approved(WALLET_A, new FakeX());
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x: null, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "unavailable" });
    expect(await conn.select().from(xAccounts)).toHaveLength(0);
  });

  it("stores nothing when X does not answer, and logs neither the code nor the verifier", async () => {
    const x = new FakeX();
    x.failNext();
    const flow = approved(WALLET_A, x);
    const logs = captureLogs();
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    expect(out).toEqual({ slug: SLUG, outcome: "x_failed" });
    expect(await conn.select().from(xAccounts)).toHaveLength(0);

    const text = logs();
    expect(text).toContain("x did not identify the account");
    expect(text).toContain('"step":"token"');
    for (const leak of [CODE, peek(flow.flowToken).cv, flow.state, flow.flowToken]) expect(text).not.toContain(leak);
  });

  describe("with the real adapter over a failing X", () => {
    const BEARER = "bearer.sentinel.1";
    const HANDLE = "handle_sentinel_1";
    const tokenOk: FakeReply = { status: 200, body: { token_type: "bearer", access_token: BEARER } };
    const config = { clientId: "client-id-1", clientSecret: "client-pass-1", redirectUri: "https://proofwork.test/api/x/callback" };

    /** X answers the token call with `token` and the account lookup with `me`. */
    function failingX(token: FakeReply, me: FakeReply): XApi {
      return new XApi(config, fakeFetch((url) => (url.endsWith("/2/oauth2/token") ? token : me)));
    }

    it.each<[string, FakeReply, FakeReply, string, number]>([
      ["the token exchange answers 400 and echoes the code", { status: 400, body: { error_description: `invalid code ${CODE}` } }, tokenOk, "token", 400],
      ["the token reply has no token", { status: 200, body: { handle: HANDLE } }, tokenOk, "token", 200],
      ["the account lookup answers 401 and echoes the token", tokenOk, { status: 401, body: { detail: `bad ${BEARER} for ${HANDLE}` } }, "identity", 401],
      ["the account lookup answers 503 with a page", tokenOk, new Response(`<html>${HANDLE}</html>`, { status: 503 }), "identity", 503],
      ["the account reply has a handle but no usable ID", tokenOk, { status: 200, body: { data: { id: "n/a", username: HANDLE } } }, "identity", 200],
    ])("stores nothing and logs only the failed step and HTTP status when %s", async (_label, token, me, step, status) => {
      const x = failingX(token, me);
      const flow = approved(WALLET_A, new FakeX());
      const logs = captureLogs();
      const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
      expect(out).toEqual({ slug: SLUG, outcome: "x_failed" });
      expect(await conn.select().from(xAccounts)).toHaveLength(0);

      const text = logs();
      const lines = text.trim().split("\n");
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
      expect(line).toMatchObject({ level: "warn", msg: "x did not identify the account", step, status });
      // Timestamp, level, message, and the adapter's step, reason and status: nothing else rides along.
      expect(Object.keys(line).sort()).toEqual(["level", "msg", "reason", "status", "step", "t"]);
      for (const leak of [CODE, peek(flow.flowToken).cv, BEARER, HANDLE, config.clientSecret, flow.state]) expect(text).not.toContain(leak);
    });

    it("stores the ID and logs only the bind when X answers, handle and name included", async () => {
      const x = failingX(tokenOk, { status: 200, body: { data: { id: "7770001", name: "Name Sentinel", username: HANDLE } } });
      const flow = approved(WALLET_A, new FakeX());
      const logs = captureLogs();
      const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
      expect(out.outcome).toBe("connected");
      const text = logs();
      expect(text.trim().split("\n")).toHaveLength(1);
      expect(text).toContain('"msg":"x account bind"');
      for (const leak of [HANDLE, "Name Sentinel", "7770001", BEARER, CODE]) expect(text).not.toContain(leak);
      expect(JSON.stringify(await conn.select().from(xAccounts))).not.toContain(HANDLE);
    });
  });

  it("logs nothing a non-adapter failure carries", async () => {
    const flow = approved(WALLET_A, new FakeX());
    const broken = {
      authorizeUrl: () => "",
      identify: async ({ code, codeVerifier }: { code: string; codeVerifier: string }) => {
        throw new Error(`boom ${code} ${codeVerifier}`);
      },
    };
    const logs = captureLogs();
    const out = await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: flow.query, x: broken, conn, now: NOW });
    expect(out.outcome).toBe("x_failed");
    for (const leak of [CODE, peek(flow.flowToken).cv]) expect(logs()).not.toContain(leak);
  });

  it("writes no log line at all on the paths that never reach X", async () => {
    const x = new FakeX();
    x.approveAs("111");
    const flow = approved(WALLET_A, x);
    const logs = captureLogs();
    await finishConnect({ pubkey: WALLET_A, flowToken: flow.flowToken, query: { state: flow.state, error: "access_denied" }, x, conn, now: NOW });
    await finishConnect({ pubkey: WALLET_B, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    await finishConnect({ pubkey: null, flowToken: flow.flowToken, query: flow.query, x, conn, now: NOW });
    expect(logs()).toBe("");
  });
});
