import { z } from "zod";
import { postIdSchema } from "@/domain/submission-url";
import { xUserIdSchema } from "@/domain/x-connect";
import { AppError } from "@/lib/errors";
import type { PostAuthor, XPort } from "./port";

/**
 * X over plain fetch: Sign in with X and the post-author lookup.
 *
 * Sign in with X, read from docs.x.com (OAuth 2.0 authorization code with
 * PKCE, GET /2/users/me) on 2026-10-13:
 *   - authorize: https://x.com/i/oauth2/authorize, PKCE with S256
 *   - token: POST https://api.x.com/2/oauth2/token, form-encoded; a
 *     confidential client authenticates with HTTP Basic and sends no client_id
 *   - identity: GET https://api.x.com/2/users/me with the bearer token, which
 *     needs the scopes users.read and tweet.read
 *   - the authorization code is valid for 30 seconds
 *
 * No offline.access, so X issues no refresh token. The access token lives in
 * one local variable for the length of `identify` and is never returned,
 * stored or logged.
 *
 * Post-author lookup, read from https://api.x.com/2/openapi.json v2.170 and
 * docs.x.com (response codes and errors, rate limits) on 2026-10-13:
 *   - GET https://api.x.com/2/tweets/{id}, id `^[0-9]{1,19}$`, accepts the
 *     app-only bearer token
 *   - the author is `data.author_id`, returned only with `expansions=author_id`;
 *     `post.fields` has no such value
 *   - the reply always carries the post's `text`, and the expansion adds the
 *     author's handle and name under `includes`: none of it is parsed
 *   - a missing or deleted post is a problem of type `.../resource-not-found`
 *     and a protected one `.../not-authorized-for-resource`, in `errors` on a
 *     200 or as the body of a 4xx
 *   - 429 carries `x-rate-limit-reset`, a Unix timestamp
 * Not exercised against X yet: the first live call must confirm this shape.
 *
 * Errors carry the step, the HTTP status and, on a 429, the reset time only:
 * X's bodies and the request parameters stay out of them.
 */
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const ME_URL = "https://api.x.com/2/users/me";
const POST_URL = "https://api.x.com/2/tweets";

/** The least X accepts for GET /2/users/me. The contributor's token reads no posts. */
const SCOPE = "users.read tweet.read";

const DEFAULT_TIMEOUT_MS = 10_000;

const tokenSchema = z.object({ access_token: z.string().min(1) });
/** `name` and `username` are in the reply too; they are not parsed, so they cannot leave. */
const meSchema = z.object({ data: z.object({ id: xUserIdSchema }) });
/** `text`, `includes` and every other field of the reply are stripped here. */
const postSchema = z.object({ data: z.object({ author_id: xUserIdSchema }) });

/** X saying the post is not there to be read: missing, deleted or protected. Older replies name the twitter.com host. */
const NOT_VISIBLE = /^https:\/\/api\.(?:x|twitter)\.com\/2\/problems\/(?:resource-not-found|not-authorized-for-resource)$/;
const problem = z.object({ type: z.string() });
/** A reply with no post in it and a problem, either as the body itself or under `errors`. Only `type` is read. */
const noPostSchema = z.union([
  z.object({ data: z.undefined().optional(), errors: z.array(problem).min(1) }).transform((v) => v.errors),
  problem.transform((v) => [v]),
]);
/** Statuses whose body can say "no such post"; any other non-200 is X failing to answer. */
const NO_POST_STATUSES: ReadonlySet<number> = new Set([200, 403, 404]);

type Step = "token" | "identity" | "post";
type Reason = "unreachable" | "status" | "body" | "id";

function failed(step: Step, details: { reason: Reason; status?: number; resetAt?: number }): AppError {
  return new AppError("X", `x ${step} request failed`, { step, ...details });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface XApiConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** app-only token, used for the post-author lookup alone */
  bearerToken: string;
}

export class XApi implements XPort {
  constructor(
    private readonly config: XApiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const params: Array<[string, string]> = [
      ["response_type", "code"],
      ["client_id", this.config.clientId],
      ["redirect_uri", this.config.redirectUri],
      ["scope", SCOPE],
      ["state", state],
      ["code_challenge", codeChallenge],
      ["code_challenge_method", "S256"],
    ];
    // Percent-encoded by hand: X documents the scope list with %20, and URLSearchParams would write "+".
    return `${AUTHORIZE_URL}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
  }

  async identify({ code, codeVerifier }: { code: string; codeVerifier: string }): Promise<{ xUserId: string }> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const token = await this.call(
      "token",
      TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          redirect_uri: this.config.redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      },
      tokenSchema,
    );
    const me = await this.call("identity", ME_URL, { method: "GET", headers: { authorization: `Bearer ${token.access_token}` } }, meSchema);
    return { xUserId: me.data.id };
  }

  async postAuthor(postId: string): Promise<PostAuthor> {
    // The ID becomes part of the path, so it is checked here whatever the caller did.
    if (!postIdSchema.safeParse(postId).success) throw failed("post", { reason: "id" });
    const { status, text, resetAt } = await this.send("post", `${POST_URL}/${postId}?expansions=author_id`, {
      method: "GET",
      headers: { authorization: `Bearer ${this.config.bearerToken}` },
    });
    if (!NO_POST_STATUSES.has(status)) throw failed("post", { reason: "status", status, ...(resetAt === undefined ? {} : { resetAt }) });
    const json = parseJson(text);
    if (status === 200) {
      const post = postSchema.safeParse(json);
      if (post.success) return { found: true, authorId: post.data.data.author_id };
    }
    const problems = noPostSchema.safeParse(json);
    if (problems.success && problems.data.some((p) => NOT_VISIBLE.test(p.type))) return { found: false };
    throw failed("post", { reason: status === 200 ? "body" : "status", status });
  }

  /** One request that must answer 200 with a body the schema accepts. */
  private async call<T>(step: Step, url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const { status, text } = await this.send(step, url, init);
    if (status !== 200) throw failed(step, { reason: "status", status });
    const parsed = schema.safeParse(parseJson(text));
    if (!parsed.success) throw failed(step, { reason: "body", status });
    return parsed.data;
  }

  /** The one place a request leaves for X. Answers with the status, the raw body and, on a 429, when the limit resets. */
  private async send(step: Step, url: string, init: RequestInit): Promise<{ status: number; text: string; resetAt?: number }> {
    try {
      // A redirect would leave the fixed host, so it is an error, not followed.
      const res = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
      // The body read can time out too: same failure as the connect.
      const text = await res.text();
      const reset = res.status === 429 ? res.headers.get("x-rate-limit-reset") : null;
      return { status: res.status, text, ...(reset !== null && /^[0-9]{1,12}$/.test(reset) ? { resetAt: Number(reset) } : {}) };
    } catch {
      // The cause is dropped on purpose: nothing from the request may ride along.
      throw failed(step, { reason: "unreachable" });
    }
  }
}
