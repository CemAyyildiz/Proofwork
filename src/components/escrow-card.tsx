import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import { budgetMeter, formatUsdc } from "@/lib/format";

/** "95 USDC" → "95": the unit is set small beside the figure. */
function figure(amount: string): string {
  return formatUsdc(amount).replace(/ USDC$/, "");
}

/** Live escrow balance, contract link and, once closed, the remainder return. */
export function EscrowCard({
  contractId,
  balance,
  budget,
  closed,
  remainderTxHash,
}: {
  contractId: string | null;
  balance: string | null;
  budget: string;
  closed: boolean;
  remainderTxHash: string | null;
}) {
  const meter = budgetMeter(balance, budget);

  return (
    <Card glow className="overflow-hidden bg-linear-180 from-raised to-surface p-6 md:p-[26px]">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow as="span">Escrow balance</Eyebrow>
        {balance !== null ? (
          <span className="inline-flex items-center gap-2 font-mono text-xs font-medium text-pass">
            <span aria-hidden="true" className="h-[7px] w-[7px] animate-ping rounded-full bg-current" />
            Live from Stellar
          </span>
        ) : null}
      </div>

      {!contractId ? (
        <>
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.04em] text-text-2">Not funded yet</p>
          <p className="mt-3 text-sm text-muted">The funder has not deployed the escrow for this campaign.</p>
        </>
      ) : balance === null ? (
        <p className="mt-4 text-lg font-semibold text-fail">Balance unavailable, check on-chain</p>
      ) : (
        <>
          <p className="mt-3.5 text-[64px] font-semibold leading-none tracking-[-0.05em] md:text-[84px]">
            {figure(balance)}
            <small className="ml-[0.25em] text-[0.36em] font-medium tracking-[-0.01em] text-muted">USDC held</small>
          </p>
          {meter ? (
            <>
              <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(meter.pct)}
                aria-valuetext={meter.label}
                aria-label="Budget left in escrow"
                className="mt-5 h-2 overflow-hidden rounded-[4px] bg-white/5"
              >
                <div className="h-full origin-left animate-grow rounded-[4px] bg-accent" style={{ width: `${meter.pct}%` }} />
              </div>
              <p className="mt-2.5 text-[12.5px] text-muted">
                {meter.label}
              </p>
            </>
          ) : null}
        </>
      )}

      <p className="mt-5 flex items-start gap-3 border-t border-line pt-[18px] text-[13.5px] leading-normal text-text-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" className="mt-0.5 shrink-0 stroke-accent" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Proofwork can&apos;t move this money. Only the funder releases payouts; only a neutral resolver can return what&apos;s left.
      </p>
      {contractId ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-muted">Escrow contract</span>
          <HashChip value={contractId} href={publicEnv.explorerContractUrl(contractId)} />
        </div>
      ) : null}
      {closed ? <RemainderReturn txHash={remainderTxHash} balance={balance} /> : null}
    </Card>
  );
}


/**
 * The hash is recorded only after the resolver's withdraw confirms, so until
 * then the return is pending, never shown as done. An escrow that closed
 * empty has nothing to return and gets no hash.
 */
function RemainderReturn({ txHash, balance }: { txHash: string | null; balance: string | null }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {txHash ? (
        <>
          <span className="text-[13px] text-muted">Remainder returned to funder</span>
          <HashChip value={txHash} href={publicEnv.explorerTxUrl(txHash)} />
        </>
      ) : (
        <span className="text-[13px] text-muted">
          {balance !== null && Number(balance) === 0 ? "Nothing left to return" : "Remainder return pending"}
        </span>
      )}
    </div>
  );
}
