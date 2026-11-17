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

const line = "inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full px-3.5 py-1.5 text-[13px]";

/** Shown while the balance streams in after the rest of the page. */
export function EscrowBalanceLoading() {
  return (
    <p className={`${line} bg-white/[0.05] text-white/55`}>
      <span aria-hidden="true" className="size-1.5 animate-ping rounded-full bg-white/60 text-white/60" />
      Reading balance from Stellar…
    </p>
  );
}

/** The funder page's balance line; rendered inside <Suspense> so the page never waits on the chain read. */
export async function EscrowBalance({ slug, contractId }: { slug: string; contractId: string }) {
  const balance = await liveBalance(slug, contractId);
  if (balance === null) {
    return (
      <p className={`${line} border border-fail-line text-fail`}>
        Balance unavailable, check on-chain:{" "}
        <a className="underline underline-offset-4" href={publicEnv.explorerContractUrl(contractId)} target="_blank" rel="noreferrer">
          escrow on stellar.expert
        </a>
      </p>
    );
  }
  return (
    <p className={`${line} bg-accent/10 text-white/70 [&_strong]:font-semibold [&_strong]:text-accent`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
      Balance <strong>{formatUsdc(balance)}</strong> <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45">read from Stellar</span>
    </p>
  );
}
