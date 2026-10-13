/**
 * Boundary to X: Sign in with X (OAuth 2.0 authorization code with PKCE) and
 * the post-author lookup. Services depend on this interface; only `api.ts`
 * knows X's endpoints.
 *
 * The one thing that crosses it is a numeric X account ID. The access token,
 * the handle, the display name and the text of a post stay inside the adapter
 * and are dropped before a method returns.
 */
export interface XPort {
  /** Where the contributor's browser goes to approve the connection. */
  authorizeUrl(input: { state: string; codeChallenge: string }): string;
  /** Trades the authorization code for the ID of the account that approved. */
  identify(input: { code: string; codeVerifier: string }): Promise<{ xUserId: string }>;
  /**
   * Who wrote a post, by its numeric ID, asked with the app's own token.
   * `found: false` is X saying the post does not exist, was deleted or is not
   * public. Throws when X gives no usable answer.
   */
  postAuthor(postId: string): Promise<PostAuthor>;
}

export type PostAuthor = { found: true; authorId: string } | { found: false };
