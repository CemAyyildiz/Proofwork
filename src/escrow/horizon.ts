import { z } from "zod";
import { AppError } from "@/lib/errors";

/** Whether a transaction is on chain and successful. Injected so unit tests need no network. */
export type TxLandedReader = (txHash: string) => Promise<boolean>;

const TX_HASH = /^[0-9a-f]{64}$/;
const horizonTx = z.object({ successful: z.boolean() });

export interface HorizonTxOptions {
  fetchImpl?: typeof fetch;
  /** Horizon can lag the network by a ledger or two after a submit: a 404 is asked again before it counts. */
  notFoundRetries?: number;
  retryMs?: number;
}

/**
 * Horizon's record of a transaction: true only for one it reports as
 * successful. 404 (after the retries) → false; any other unreadable answer
 * throws, so a caller never takes "could not ask" for "did not land".
 */
export function horizonTxLanded(horizonUrl: string, o: HorizonTxOptions = {}): TxLandedReader {
  const fetchImpl = o.fetchImpl ?? fetch;
  // About 15 s: a 404 here turns a landed op into a failed one, and for a deploy a
  // failed op is prepared again, so the window covers several ledgers of Horizon lag.
  const retries = o.notFoundRetries ?? 10;
  const retryMs = o.retryMs ?? 1_500;
  const base = horizonUrl.replace(/\/+$/, "");
  return async (txHash) => {
    if (!TX_HASH.test(txHash)) return false;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${base}/transactions/${txHash}`,{ headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) {
        if (attempt + 1 >= retries) return false;
        await new Promise((r) => setTimeout(r, retryMs));
        continue;
      }
      if (!res.ok) throw new AppError("ESCROW", `Horizon answered ${res.status} for transaction ${txHash.slice(0, 12)}…`);
      const parsed = horizonTx.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new AppError("ESCROW", "unexpected transaction response from Horizon");
      return parsed.data.successful;
    }
  };
}
