import { describe, expect, it } from "vitest";
import { XApi } from "@/x/api";
import { fakeFetch, type FakeReply } from "./fake-fetch";

// Recognisable stand-ins, so a leak into a result or an error is easy to assert on.
const CLIENT_ID = "client-id-1";
const CLIENT_PASS = "client-pass-1";
const REDIRECT = "https://proofwork.test/api/x/callback";
const CODE = "code.sentinel.1";
const VERIFIER = "verifier.sentinel.1";
const BEARER = "bearer.sentinel.1";
const HANDLE = "handle_sentinel_1";
const NAME = "Name Sentinel";

const config = { clientId: CLIENT_ID, clientSecret: CLIENT_PASS, redirectUri: REDIRECT };

interface Seen {
  url: string;
  init: RequestInit;
}

/** Answers the token call and then the identity call; records both requests. */
function xStub(token: FakeReply, me?: FakeReply): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: fakeFetch((url, init) => {
      seen.push({ url, init });
      if (url === "https://api.x.com/2/oauth2/token") return token;
      if (url === "https://api.x.com/2/users/me" && me) return me;
      throw new Error(`unexpected request to ${url}`);
    }),
  };
}

const tokenOk: FakeReply = { status: 200, body: { token_type: "bearer", expires_in: 7200, access_token: BEARER, scope: "users.read tweet.read" } };
const meOk: FakeReply = { status: 200, body: { data: { id: "111", name: NAME, username: HANDLE } } };

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe("XApi.authorizeUrl", () => {
  const url = new URL(new XApi(config).authorizeUrl({ state: "state-1", codeChallenge: "challenge-1" }));

  it("points at X's authorize endpoint", () => {
    expect(`${url.origin}${url.pathname}`).toBe("https://x.com/i/oauth2/authorize");
  });

  it("asks for a code with PKCE S256 and carries state, client and callback", () => {
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "users.read tweet.read",
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
    });
  });

  it("requests the two identity scopes and no refresh token", () => {
    const raw = new XApi(config).authorizeUrl({ state: "s", codeChallenge: "c" });
    expect(raw).toContain("scope=users.read%20tweet.read&");
    expect(raw).not.toContain("offline.access");
  });

  it("never carries the client secret", () => {
    expect(url.toString()).not.toContain(CLIENT_PASS);
  });
});

describe("XApi.identify", () => {
  it("exchanges the code as a confidential client: form body, Basic auth, no client_id in the body", async () => {
    const x = xStub(tokenOk, meOk);
    await new XApi(config, x.fetch).identify({ code: CODE, codeVerifier: VERIFIER });

    const token = x.seen[0];
    expect(token?.url).toBe("https://api.x.com/2/oauth2/token");
    expect(token?.init.method).toBe("POST");
    expect(header(token?.init ?? {}, "content-type")).toBe("application/x-www-form-urlencoded");
    expect(header(token?.init ?? {}, "authorization")).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_PASS}`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(String(token?.init.body)))).toEqual({
      code: CODE,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
  });

  it("reads the account with the bearer token and nothing else", async () => {
    const x = xStub(tokenOk, meOk);
    await new XApi(config, x.fetch).identify({ code: CODE, codeVerifier: VERIFIER });

    expect(x.seen).toHaveLength(2);
    const me = x.seen[1];
    expect(me?.url).toBe("https://api.x.com/2/users/me");
    expect(me?.init.method).toBe("GET");
    expect(header(me?.init ?? {}, "authorization")).toBe(`Bearer ${BEARER}`);
    expect(me?.init.body).toBeUndefined();
  });

  it("refuses to follow a redirect off the fixed hosts", async () => {
    const x = xStub(tokenOk, meOk);
    await new XApi(config, x.fetch).identify({ code: CODE, codeVerifier: VERIFIER });
    expect(x.seen.map((s) => s.init.redirect)).toEqual(["error", "error"]);
  });

  it("returns the account ID and only the account ID", async () => {
    const x = xStub(tokenOk, meOk);
    const out = await new XApi(config, x.fetch).identify({ code: CODE, codeVerifier: VERIFIER });
    expect(out).toEqual({ xUserId: "111" });
    const text = JSON.stringify(out);
    for (const leak of [BEARER, HANDLE, NAME]) expect(text).not.toContain(leak);
  });

  it("keeps a 64-bit account ID exact", async () => {
    const x = xStub(tokenOk, { status: 200, body: { data: { id: "18446744073709551615", username: HANDLE } } });
    await expect(new XApi(config, x.fetch).identify({ code: CODE, codeVerifier: VERIFIER })).resolves.toEqual({ xUserId: "18446744073709551615" });
  });

  describe("failures", () => {
    /** Runs `identify` against the stub and returns what it threw, serialised with everything an error can carry. */
    async function failure(fetchImpl: typeof fetch, timeoutMs?: number): Promise<{ error: unknown; text: string }> {
      const api = new XApi(config, fetchImpl, timeoutMs);
      const error = await api.identify({ code: CODE, codeVerifier: VERIFIER }).then(
        () => {
          throw new Error("identify should have failed");
        },
        (e: unknown) => e,
      );
      const e = error as { message?: string; details?: unknown; cause?: unknown; stack?: string };
      return { error, text: JSON.stringify([e.message, e.details, String(e.cause), e.stack]) };
    }

    function expectNoLeak(text: string): void {
      for (const leak of [CODE, VERIFIER, BEARER, HANDLE, NAME, CLIENT_PASS]) expect(text).not.toContain(leak);
    }

    it("is a typed X error when the token exchange answers non-200, and the account is never asked", async () => {
      const x = xStub({ status: 400, body: { error: "invalid_request", error_description: `Value passed for the authorization code was invalid: ${CODE}` } });
      const { error, text } = await failure(x.fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "token", reason: "status", status: 400 } });
      expect(x.seen).toHaveLength(1);
      expectNoLeak(text);
    });

    it("is a typed X error when the token reply has no access token", async () => {
      const x = xStub({ status: 200, body: { token_type: "bearer" } });
      const { error } = await failure(x.fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "token", reason: "body" } });
      expect(x.seen).toHaveLength(1);
    });

    it("is a typed X error when the token reply is not JSON", async () => {
      const x = xStub(new Response("<html>bad gateway</html>", { status: 200 }));
      const { error } = await failure(x.fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "token", reason: "body" } });
    });

    it("is a typed X error when the identity call answers non-200", async () => {
      const x = xStub(tokenOk, { status: 401, body: { title: "Unauthorized", detail: `bad token ${BEARER}` } });
      const { error, text } = await failure(x.fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "identity", reason: "status", status: 401 } });
      expectNoLeak(text);
    });

    it.each([
      ["no data", { errors: [{ detail: "not found" }] }],
      ["a non-numeric id", { data: { id: "abc", username: HANDLE } }],
      ["an id longer than 64 bits can be", { data: { id: "1".repeat(21), username: HANDLE } }],
      ["a numeric id that is not a string", { data: { id: 111, username: HANDLE } }],
    ])("is a typed X error when the identity reply has %s", async (_label, body) => {
      const x = xStub(tokenOk, { status: 200, body });
      const { error, text } = await failure(x.fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "identity", reason: "body" } });
      expectNoLeak(text);
    });

    it("is a typed X error when the request cannot be made", async () => {
      const { error, text } = await failure((async () => {
        throw new TypeError(`fetch failed for code=${CODE}`);
      }) as typeof fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "token", reason: "unreachable" } });
      expectNoLeak(text);
    });

    it("gives up when X does not answer in time", async () => {
      const hanging = ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof fetch;
      const { error } = await failure(hanging, 20);
      expect(error).toMatchObject({ code: "X", details: { step: "token", reason: "unreachable" } });
    });
  });
});
