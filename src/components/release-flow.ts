import { isSignatureRejection, walletErrorMessage } from "@/wallet/onboarding";

/** A release transaction the server prepared for one of the selected payouts. */
export interface PreparedRelease {
  opId: string;
  unsignedXdr: string;
}

export interface ReleasedPayout {
  milestoneIndex: number;
  txHash: string;
}

export interface ReleaseStop {
  /**
   * `cancelled`: the wallet declined to sign, nothing went out for this payout.
   * `failed`: the server refused to prepare, or the wallet failed to sign; nothing went out for this payout.
   * `unknown`: the signed transaction was handed over and the answer was lost or an error; it may be on chain.
   */
  kind: "cancelled" | "failed" | "unknown";
  message: string;
}

export interface ReleaseResult {
  /** Every payout confirmed on chain in this run, in order, with its tx hash. */
  released: ReleasedPayout[];
  /** Selected payouts that were not sent to the chain because the run stopped. */
  unsent: number;
  stop: ReleaseStop | null;
}

export interface ReleaseDeps {
  submissionIds: string[];
  /** The server's next release among the selection, or null when none is left. */
  prepare: (submissionIds: string[]) => Promise<PreparedRelease | null>;
  sign: (unsignedXdr: string) => Promise<string>;
  submit: (op: { opId: string; signedXdr: string }) => Promise<ReleasedPayout>;
  /** Called before the wallet is asked for the n-th of `total` signatures. */
  onProgress?: (n: number, total: number) => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : walletErrorMessage(e);
}

/**
 * Releases the selected payouts one transaction at a time: each envelope
 * carries the funder account's sequence number, so the next is prepared only
 * after the last one is confirmed. Stops at the first cancel or error and
 * says exactly what landed. A cancel is read only from the signing step; a
 * server answer is never taken for one, whatever its text says.
 */
export async function releaseSelected({ submissionIds, prepare, sign, submit, onProgress }: ReleaseDeps): Promise<ReleaseResult> {
  const selection = [...new Set(submissionIds)];
  const total = selection.length;
  const released: ReleasedPayout[] = [];
  const stopped = (stop: ReleaseStop, inFlight: number): ReleaseResult => ({ released, unsent: total - released.length - inFlight, stop });

  // Each confirmed release takes one payout out of the selection, so `total` rounds are enough.
  for (let round = 0; round < total; round++) {
    let op: PreparedRelease | null;
    try {
      op = await prepare(selection);
    } catch (e) {
      return stopped({ kind: "failed", message: message(e) }, 0);
    }
    if (!op) break;

    onProgress?.(released.length + 1, total);
    let signedXdr: string;
    try {
      signedXdr = await sign(op.unsignedXdr);
    } catch (e) {
      if (isSignatureRejection(e)) return stopped({ kind: "cancelled", message: "Signature cancelled in your wallet" }, 0);
      return stopped({ kind: "failed", message: message(e) }, 0);
    }

    try {
      released.push(await submit({ opId: op.opId, signedXdr }));
    } catch (e) {
      return stopped({ kind: "unknown", message: message(e) }, 1);
    }
  }
  return { released, unsent: 0, stop: null };
}

export interface ReleaseOutcome {
  tone: "ok" | "muted" | "fail";
  /** "1 of 3 released": shown before the released tx links. Null when nothing was released. */
  headline: string | null;
  /** What did not happen, and why. Empty when every selected payout was released. */
  detail: string;
}

/** The funder-facing outcome of a release run over `total` selected payouts. */
export function describeRelease(result: ReleaseResult, total: number): ReleaseOutcome {
  const done = result.released.length;
  const headline = done > 0 ? `${done} of ${total} released` : null;
  const unsent = result.unsent > 0 ? `${result.unsent} not sent.` : "";
  const stop = result.stop;

  if (!stop) {
    const left = total - done;
    if (left === 0) return { tone: "ok", headline, detail: "" };
    if (done === 0) {
      const what = total === 1 ? "The selected payout can't be released" : `None of the ${total} selected payouts can be released`;
      return { tone: "muted", headline, detail: `${what} (not approved, already paid or not in this campaign). Nothing was sent.` };
    }
    return { tone: "ok", headline, detail: `${left} not releasable (not approved, already paid or not in this campaign).` };
  }

  switch (stop.kind) {
    case "cancelled":
      return done === 0
        ? { tone: "muted", headline, detail: `${stop.message}. Nothing was sent.` }
        : { tone: "muted", headline, detail: `${stop.message}; ${unsent}` };
    case "failed":
      return done === 0
        ? { tone: "fail", headline, detail: `Release stopped: ${stop.message}. Nothing was sent.` }
        : { tone: "fail", headline, detail: `Release stopped: ${stop.message}; ${unsent}` };
    case "unknown":
      return {
        tone: "fail",
        headline,
        detail: `Payout ${done + 1} of ${total} may have reached the chain; refresh to see (${stop.message}).${unsent ? ` ${unsent}` : ""}`,
      };
  }
}
