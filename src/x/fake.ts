import { AppError } from "@/lib/errors";
import type { PostAuthor, XPort } from "./port";

/**
 * In-memory XPort for unit tests. `identify` answers with the account set by
 * `approveAs`, or fails the way the adapter does when X does not answer.
 * `postAuthor` answers from the posts added with `addPost`; a post that was
 * never added is one X cannot find.
 */
export class FakeX implements XPort {
  /** every `identify` call that reached "X" */
  readonly identified: Array<{ code: string; codeVerifier: string }> = [];
  /** every post ID `postAuthor` was asked about */
  readonly lookedUp: string[] = [];
  private account: string | null = null;
  private readonly posts = new Map<string, string>();
  private postsDown = false;

  /** The X account that approves the next connections. */
  approveAs(xUserId: string): void {
    this.account = xUserId;
  }

  /** X stops answering: the next `identify` calls throw. */
  failNext(): void {
    this.account = null;
  }

  /** A public post and the account that wrote it. */
  addPost(postId: string, authorId: string): void {
    this.posts.set(postId, authorId);
  }

  /** X stops answering post lookups: the next `postAuthor` calls throw. */
  failPosts(): void {
    this.postsDown = true;
  }

  authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    return `https://x.test/authorize?state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}`;
  }

  async identify(input: { code: string; codeVerifier: string }): Promise<{ xUserId: string }> {
    this.identified.push(input);
    if (this.account === null) throw new AppError("X", "x token request failed", { step: "token", reason: "unreachable" });
    return { xUserId: this.account };
  }

  async postAuthor(postId: string): Promise<PostAuthor> {
    this.lookedUp.push(postId);
    if (this.postsDown) throw new AppError("X", "x post request failed", { step: "post", reason: "status", status: 503 });
    const authorId = this.posts.get(postId);
    return authorId === undefined ? { found: false } : { found: true, authorId };
  }
}
