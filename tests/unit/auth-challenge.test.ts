import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { makeTestDb } from "./db";

/**
 * Wallet login end to end: the nonce services on a real (in-process)
 * database, the challenge, verify and logout routes, and the session token.
 * Only the database and the cookie jar are swapped.
 */
const world = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  conn: undefined as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      world.jar.set(name, value);
    },
    delete: (name: string) => {
      world.jar.delete(name);
    },
  }),
}));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));

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

const { consumeChallenge, issueChallenge } = await import("@/services/auth");
const { decodeSession, encodeSession } = await import("@/lib/session");
const challengeRoute = await import("@/app/api/auth/challenge/route");
const verifyRoute = await import("@/app/api/auth/verify/route");
const logoutRoute = await import("@/app/api/auth/logout/route");
const appealRoute = await import("@/app/api/submissions/[id]/appeal/route");

const HOST = "proofwork.test";
const COOKIE = "pw_session";

/** A wallet's SEP-53 signature over the exact text the server returned. */
function sign(kp: Keypair, message: string): string {
  return kp.sign(createHash("sha256").update("Stellar Signed Message:\n" + message, "utf8").digest()).toString("base64");
}

function post(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

let conn: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
});

afterEach(async () => {
  vi.useRealTimers();
  await close();
});

describe("login challenge", () => {
  it("binds the host, account, network and validity window, and is accepted once", async () => {
    const kp = Keypair.random();
    const { nonce, message } = await issueChallenge(kp.publicKey(), HOST, conn);
    expect(message).toContain(`${HOST} asks you to sign in to Proofwork`);
    expect(message).toContain(`account: ${kp.publicKey()}`);
    expect(message).toContain("network: Stellar testnet");
    expect(message).toContain(`nonce: ${nonce}`);
    expect(message).toMatch(/issued at: \S+Z\nexpires at: \S+Z$/);

    const input = { pubkey: kp.publicKey(), nonce, signature: sign(kp, message) };
    await expect(consumeChallenge(input, HOST, conn)).resolves.toEqual({ pubkey: kp.publicKey() });
    await expect(consumeChallenge(input, HOST, conn)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("refuses a challenge past its expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const kp = Keypair.random();
    const { nonce, message } = await issueChallenge(kp.publicKey(), HOST, conn);
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    await expect(consumeChallenge({ pubkey: kp.publicKey(), nonce, signature: sign(kp, message) }, HOST, conn)).rejects.toThrow(/expired/);
  });

  it("refuses another wallet's signature over the nonce", async () => {
    const [a, b] = [Keypair.random(), Keypair.random()];
    const { nonce, message } = await issueChallenge(a.publicKey(), HOST, conn);
    await expect(consumeChallenge({ pubkey: a.publicKey(), nonce, signature: sign(b, message) }, HOST, conn)).rejects.toThrow(/does not verify/);
    // Nor can B claim A's nonce with its own key.
    await expect(consumeChallenge({ pubkey: b.publicKey(), nonce, signature: sign(b, message) }, HOST, conn)).rejects.toThrow(/unknown or used/);
  });

  it("refuses a signature collected for another site", async () => {
    const kp = Keypair.random();
    const { nonce, message } = await issueChallenge(kp.publicKey(), "evil.example", conn);
    await expect(consumeChallenge({ pubkey: kp.publicKey(), nonce, signature: sign(kp, message) }, HOST, conn)).rejects.toThrow(/does not verify/);
  });

  it("takes the host from the request, through the real routes", async () => {
    const kp = Keypair.random();
    const res = await challengeRoute.POST(post(`https://${HOST}/api/auth/challenge`, { pubkey: kp.publicKey() }));
    expect(res.status).toBe(200);
    const { nonce, message } = (await res.json()) as { nonce: string; message: string };
    expect(message).toContain(`${HOST} asks you to sign in`);
    const body = { pubkey: kp.publicKey(), nonce, signature: sign(kp, message) };

    const elsewhere = await verifyRoute.POST(post("https://other.example/api/auth/verify", body));
    expect(elsewhere.status).toBe(401);
    expect(world.jar.has(COOKIE)).toBe(false);

    const ok = await verifyRoute.POST(post(`https://${HOST}/api/auth/verify`, body));
    expect(ok.status).toBe(200);
    expect(decodeSession(world.jar.get(COOKIE))?.pk).toBe(kp.publicKey());
  });
});

describe("session token", () => {
  const pk = Keypair.random().publicKey();

  it("is refused once expired", () => {
    const issued = Date.now() - 25 * 60 * 60 * 1000;
    const token = encodeSession(pk, issued);
    expect(decodeSession(token, issued + 1000)?.pk).toBe(pk);
    expect(decodeSession(token)).toBeNull();
  });

  it("is refused when the body was changed under the signature", () => {
    const token = encodeSession(pk);
    const [, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ pk: Keypair.random().publicKey(), iat: 0, exp: 9_999_999_999 })).toString("base64url");
    expect(decodeSession(`${other}.${sig}`)).toBeNull();
  });

  it("no longer opens a protected route after logout", async () => {
    const kp = Keypair.random();
    // Issued a second ago: logout revokes tokens issued before it.
    const token = encodeSession(kp.publicKey(), Date.now() - 1000);
    world.jar.set(COOKIE, token);
    const appeal = () => appealRoute.POST(post(`https://${HOST}/api/submissions/sub_none/appeal`, {}), { params: Promise.resolve({ id: "sub_none" }) });

    // Signed in: past authentication, to a submission that does not exist.
    expect((await appeal()).status).toBe(404);

    const out = await logoutRoute.POST(post(`https://${HOST}/api/auth/logout`, {}));
    expect(out.status).toBe(200);
    expect(world.jar.has(COOKIE)).toBe(false);

    // The old token, replayed.
    world.jar.set(COOKIE, token);
    expect((await appeal()).status).toBe(401);
  });
});
