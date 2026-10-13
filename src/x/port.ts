/**
 * Boundary to X (Sign in with X, OAuth 2.0 authorization code with PKCE).
 * Services depend on this interface; only `api.ts` knows X's endpoints.
 *
 * The one thing that crosses it is the numeric X account ID. The access token,
 * the handle and the display name stay inside the adapter and are dropped
 * before `identify` returns.
 */
export interface XPort {
  /** Where the contributor's browser goes to approve the connection. */
  authorizeUrl(input: { state: string; codeChallenge: string }): string;
  /** Trades the authorization code for the ID of the account that approved. */
  identify(input: { code: string; codeVerifier: string }): Promise<{ xUserId: string }>;
}
