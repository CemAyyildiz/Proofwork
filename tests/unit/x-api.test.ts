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
const APP_BEARER = "app.bearer.sentinel.1";
const POST_TEXT = "post text sentinel";

const config = { clientId: CLIENT_ID, clientSecret: CLIENT_PASS, redirectUri: REDIRECT, bearerToken: APP_BEARER };

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

  it("keeps a 19-digit account ID exact", async () => {
    const x = xStub(tokenOk, { status: 200, body: { data: { id: "9223372036854775807", username: HANDLE } } });
    await expect(new XApi(config, x.fetch).identify({ code: CODE, codeVerifier: VERIFIER })).resolves.toEqual({ xUserId: "9223372036854775807" });
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
      ["an id longer than the 19 digits X documents", { data: { id: "1".repeat(20), username: HANDLE } }],
      ["an id with a leading zero", { data: { id: "0111", username: HANDLE } }],
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

describe("XApi.postAuthor", () => {
  const POST = "1841200000000000000";
  const POST_URL = `https://api.x.com/2/tweets/${POST}?expansions=author_id`;

  /** What X sends for a post with the author expansion: the text and the author's handle and name ride along. */
  const postOk: FakeReply = {
    status: 200,
    body: {
      data: { id: POST, text: POST_TEXT, author_id: "111", username: HANDLE, edit_history_tweet_ids: [POST] },
      includes: { users: [{ id: "111", name: NAME, username: HANDLE }] },
    },
  };

  const problemOf = (kind: string, host = "api.x.com") => ({
    type: `https://${host}/2/problems/${kind}`,
    title: "Not Found Error",
    detail: `Could not find tweet with id: [${POST}] by ${HANDLE}.`,
    resource_type: "tweet",
    resource_id: POST,
  });

  function postStub(reply: FakeReply): { fetch: typeof fetch; seen: Seen[] } {
    const seen: Seen[] = [];
    return {
      seen,
      fetch: fakeFetch((url, init) => {
        seen.push({ url, init });
        return reply;
      }),
    };
  }

  it("asks the fixed host for the post by ID with the app token, and for nothing but the author", async () => {
    const x = postStub(postOk);
    await new XApi(config, x.fetch).postAuthor(POST);

    expect(x.seen).toHaveLength(1);
    const req = x.seen[0];
    expect(req?.url).toBe(POST_URL);
    expect(req?.init.method).toBe("GET");
    expect(header(req?.init ?? {}, "authorization")).toBe(`Bearer ${APP_BEARER}`);
    expect(req?.init.body).toBeUndefined();
    expect(req?.init.redirect).toBe("error");
    // The app token only: no client secret, and no field or expansion that would ask for more.
    expect(JSON.stringify(req)).not.toContain(CLIENT_PASS);
    expect(Object.fromEntries(new URL(req?.url ?? "").searchParams)).toEqual({ expansions: "author_id" });
  });

  it("returns the author ID and only the author ID from a reply that carries text, handle and name", async () => {
    const out = await new XApi(config, postStub(postOk).fetch).postAuthor(POST);
    expect(out).toEqual({ found: true, authorId: "111" });
    const text = JSON.stringify(out);
    for (const leak of [POST_TEXT, HANDLE, NAME, APP_BEARER]) expect(text).not.toContain(leak);
  });

  it("keeps a 19-digit author ID exact", async () => {
    const x = postStub({ status: 200, body: { data: { id: POST, text: POST_TEXT, author_id: "9223372036854775807" } } });
    await expect(new XApi(config, x.fetch).postAuthor(POST)).resolves.toEqual({ found: true, authorId: "9223372036854775807" });
  });

  it("uses the post even when the reply also lists a problem with an expansion", async () => {
    const x = postStub({ status: 200, body: { data: { id: POST, text: POST_TEXT, author_id: "111" }, errors: [problemOf("resource-not-found")] } });
    await expect(new XApi(config, x.fetch).postAuthor(POST)).resolves.toEqual({ found: true, authorId: "111" });
  });

  it.each<[string, FakeReply]>([
    ["a 200 whose errors say the post was not found", { status: 200, body: { errors: [problemOf("resource-not-found")] } }],
    ["a 404 whose body is that problem", { status: 404, body: problemOf("resource-not-found") }],
    ["a 404 that lists that problem under errors", { status: 404, body: { errors: [problemOf("resource-not-found")] } }],
    ["a 200 whose errors say the post is not visible to the app", { status: 200, body: { errors: [problemOf("not-authorized-for-resource")] } }],
    ["a 403 whose body says the post is not visible to the app", { status: 403, body: problemOf("not-authorized-for-resource") }],
    ["the problem named on the older twitter.com host", { status: 200, body: { errors: [problemOf("resource-not-found", "api.twitter.com")] } }],
  ])("answers not found, with nothing else, for %s", async (_label, reply) => {
    const out = await new XApi(config, postStub(reply).fetch).postAuthor(POST);
    expect(out).toEqual({ found: false });
  });

  describe("failures", () => {
    async function failure(fetchImpl: typeof fetch, postId = POST, timeoutMs?: number): Promise<{ error: unknown; text: string }> {
      const error = await new XApi(config, fetchImpl, timeoutMs).postAuthor(postId).then(
        () => {
          throw new Error("postAuthor should have failed");
        },
        (e: unknown) => e,
      );
      const e = error as { message?: string; details?: unknown; cause?: unknown; stack?: string };
      return { error, text: JSON.stringify([e.message, e.details, String(e.cause), e.stack]) };
    }

    function expectNoLeak(text: string): void {
      for (const leak of [APP_BEARER, POST_TEXT, HANDLE, NAME, CLIENT_PASS]) expect(text).not.toContain(leak);
    }

    it.each<[string, FakeReply, number]>([
      ["401, echoing the token", { status: 401, body: { title: "Unauthorized", type: "about:blank", detail: `bad token ${APP_BEARER}` } }, 401],
      ["403 because the app has no access", { status: 403, body: { type: "https://api.x.com/2/problems/client-forbidden", detail: HANDLE } }, 403],
      ["404 with a body that is not the not-found problem", { status: 404, body: { title: "Not Found", type: "about:blank" } }, 404],
      ["404 with a page", new Response(`<html>${HANDLE}</html>`, { status: 404 }), 404],
      ["400 for an ID X does not take", { status: 400, body: problemOf("invalid-request") }, 400],
      ["500", { status: 500, body: { type: "https://api.x.com/2/problems/internal-error", detail: POST_TEXT } }, 500],
      ["503 with a page", new Response(`<html>${POST_TEXT}</html>`, { status: 503 }), 503],
      // A problem that says "not found" does not turn a server error into an answer.
      ["502 carrying a not-found problem", { status: 502, body: problemOf("resource-not-found") }, 502],
    ])("is a typed X error on %s", async (_label, reply, status) => {
      const { error, text } = await failure(postStub(reply).fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "post", reason: "status", status } });
      expectNoLeak(text);
    });

    it("is a typed X error on 429 and carries when the limit resets, nothing else", async () => {
      const x = postStub({ status: 429, body: { title: "Too Many Requests", detail: HANDLE }, headers: { "x-rate-limit-reset": "1791900000" } });
      const { error, text } = await failure(x.fetch);
      expect((error as { details?: unknown }).details).toEqual({ step: "post", reason: "status", status: 429, resetAt: 1791900000 });
      expectNoLeak(text);
    });

    it("drops a reset header that is not a timestamp", async () => {
      const x = postStub({ status: 429, body: {}, headers: { "x-rate-limit-reset": `soon ${HANDLE}` } });
      const { error, text } = await failure(x.fetch);
      expect((error as { details?: unknown }).details).toEqual({ step: "post", reason: "status", status: 429 });
      expectNoLeak(text);
    });

    it.each<[string, FakeReply]>([
      ["no author", { status: 200, body: { data: { id: POST, text: POST_TEXT, username: HANDLE } } }],
      ["an author ID that is not numeric", { status: 200, body: { data: { id: POST, text: POST_TEXT, author_id: HANDLE } } }],
      ["an author ID with a leading zero", { status: 200, body: { data: { id: POST, text: POST_TEXT, author_id: "0111" } } }],
      ["an author ID that is a number, not a string", { status: 200, body: { data: { id: POST, text: POST_TEXT, author_id: 111 } } }],
      ["neither a post nor a problem", { status: 200, body: {} }],
      ["a problem of another kind and no post", { status: 200, body: { errors: [problemOf("resource-unavailable")] } }],
      ["a post without an author beside a not-found problem", { status: 200, body: { data: { id: POST, text: POST_TEXT }, errors: [problemOf("resource-not-found")] } }],
      ["a body that is not JSON", new Response(`<html>${POST_TEXT}</html>`, { status: 200 })],
    ])("is a typed X error when a 200 has %s", async (_label, reply) => {
      const { error, text } = await failure(postStub(reply).fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "post", reason: "body", status: 200 } });
      expectNoLeak(text);
    });

    it.each(["", "abc", "0123", "1".repeat(20), "12/../users/me", "12?expansions=author_id", " 12"])(
      "never sends a request for %j, which is not a post ID",
      async (postId) => {
        const x = postStub(postOk);
        const { error } = await failure(x.fetch, postId);
        expect(error).toMatchObject({ code: "X", details: { step: "post", reason: "id" } });
        expect(x.seen).toHaveLength(0);
      },
    );

    it("is a typed X error when the request cannot be made", async () => {
      const { error, text } = await failure((async () => {
        throw new TypeError(`fetch failed with ${APP_BEARER}`);
      }) as typeof fetch);
      expect(error).toMatchObject({ code: "X", details: { step: "post", reason: "unreachable" } });
      expectNoLeak(text);
    });

    it("gives up when X does not answer in time", async () => {
      const hanging = ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof fetch;
      const { error } = await failure(hanging, POST, 20);
      expect(error).toMatchObject({ code: "X", details: { step: "post", reason: "unreachable" } });
    });
  });
});
