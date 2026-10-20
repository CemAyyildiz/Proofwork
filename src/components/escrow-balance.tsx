import { publicEnv } from "@/config/public-env";
import { getEscrow } from "@/escrow";
import { formatUsdc } from "@/lib/format";
import { log } from "@/lib/logger";

/** Longest the funder page waits on the live escrow balance; Trustless Work reads have taken up to 15 s. */
export const BALANCE_TIMEOUT_MS = 10_000;

/** The escrow balance read from chain, or null when the read fails or is too slow: never a database figure. */
async function liveBalance(slug: string, contractId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("balance read timed out")), BALANCE_TIMEOUT_MS);
    });
    return (await Promise.race([getEscrow().getEscrow(contractId), timeout])).balance;
  } catch (e) {
    log.warn("escrow balance read failed", { slug, err: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Shown while the balance streams in after the rest of the page. */
export function EscrowBalanceLoading() {
  return <p className="text-sm text-muted">Reading balance from Stellar…</p>;
}

/** The funder page's balance line; rendered inside <Suspense> so the page never waits on the chain read. */
export async function EscrowBalance({ slug, contractId }: { slug: string; contractId: string }) {
  const balance = await liveBalance(slug, contractId);
  if (balance === null) {
    return (
      <p className="text-sm text-fail">
        Balance unavailable, check on-chain:{" "}
        <a className="underline" href={publicEnv.explorerContractUrl(contractId)} target="_blank" rel="noreferrer">
          escrow on stellar.expert
        </a>
      </p>
    );
  }
  return (
    <p className="text-sm text-text">
      Balance <strong>{formatUsdc(balance)}</strong> <span className="text-xs text-muted">read from Stellar</span>
    </p>
  );
}
