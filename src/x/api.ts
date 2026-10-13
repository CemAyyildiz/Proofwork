import { z } from "zod";
import { xUserIdSchema } from "@/domain/x-connect";
import { AppError } from "@/lib/errors";
import type { XPort } from "./port";

/**
 * Sign in with X over plain fetch. Facts this encodes, read from docs.x.com
 * (OAuth 2.0 authorization code with PKCE, GET /2/users/me) on 2026-10-13:
 *   - authorize: https://x.com/i/oauth2/authorize, PKCE with S256
 *   - token: POST https://api.x.com/2/oauth2/token, form-encoded; a
 *     confidential client authenticates with HTTP Basic and sends no client_id
 *   - identity: GET https://api.x.com/2/users/me with the bearer token, which
 *     needs the scopes users.read and tweet.read
 *   - the authorization code is valid for 30 seconds
 *
 * No offline.access, so X issues no refresh token. The access token lives in
 * one local variable for the length of `identify` and is never returned,
 * stored or logged. Errors carry the step and the HTTP status only: X's error
 * bodies and the request parameters stay out of them.
 */
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const ME_URL = "https://api.x.com/2/users/me";

/** The least X accepts for GET /2/users/me. Nothing here reads posts. */
const SCOPE = "users.read tweet.read";

const DEFAULT_TIMEOUT_MS = 10_000;

const tokenSchema = z.object({ access_token: z.string().min(1) });
/** `name` and `username` are in the reply too; they are not parsed, so they cannot leave. */
const meSchema = z.object({ data: z.object({ id: xUserIdSchema }) });

type Step = "token" | "identity";

export interface XApiConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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

  private async call<T>(step: Step, url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let status: number;
    let text: string;
    try {
      // A redirect would leave the fixed host, so it is an error, not followed.
      const res = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
      status = res.status;
      // The body read can time out too: same failure as the connect.
      text = await res.text();
    } catch {
      // The cause is dropped on purpose: nothing from the request may ride along.
      throw new AppError("X", `x ${step} request failed`, { step, reason: "unreachable" });
    }
    if (status !== 200) throw new AppError("X", `x ${step} request failed`, { step, reason: "status", status });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError("X", `x ${step} request failed`, { step, reason: "body", status });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AppError("X", `x ${step} request failed`, { step, reason: "body", status });
    return parsed.data;
  }
}
