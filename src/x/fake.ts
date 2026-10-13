import { AppError } from "@/lib/errors";
import type { XPort } from "./port";

/**
 * In-memory XPort for unit tests. `identify` answers with the account set by
 * `approveAs`, or fails the way the adapter does when X does not answer.
 */
export class FakeX implements XPort {
  /** every `identify` call that reached "X" */
  readonly identified: Array<{ code: string; codeVerifier: string }> = [];
  private account: string | null = null;

  /** The X account that approves the next connections. */
  approveAs(xUserId: string): void {
    this.account = xUserId;
  }

  /** X stops answering: the next `identify` calls throw. */
  failNext(): void {
    this.account = null;
  }

  authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    return `https://x.test/authorize?state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}`;
  }

  async identify(input: { code: string; codeVerifier: string }): Promise<{ xUserId: string }> {
    this.identified.push(input);
    if (this.account === null) throw new AppError("X", "x token request failed", { step: "token", reason: "unreachable" });
    return { xUserId: this.account };
  }
}
