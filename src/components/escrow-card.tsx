import { axes, FONT } from "@/components/site/type";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import { budgetMeter, formatUsdc } from "@/lib/format";

/** "95 USDC" → "95": the unit is set small beside the figure. */
function figure(amount: string): string {
  return formatUsdc(amount).replace(/ USDC$/, "");
}

const SEGMENTS = 24;

/** Live escrow balance, contract link and, once closed, the remainder return. A black card for paper sections. */
export function EscrowCard({
  contractId,
  balance,
  loading = false,
  budget,
  closed,
  remainderTxHash,
}: {
  contractId: string | null;
  balance: string | null;
  /** The live read is still in flight: a placeholder, not "unavailable". */
  loading?: boolean;
  budget: string;
  closed: boolean;
  remainderTxHash: string | null;
}) {
  const meter = budgetMeter(balance, budget);
  const lit = meter ? Math.round((meter.pct / 100) * SEGMENTS) : 0;

  return (
    <div className="relative overflow-hidden rounded-[28px] bg-black p-6 text-white shadow-[0_40px_100px_-50px_rgba(0,0,0,0.7)] md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">Escrow balance</span>
        {balance !== null ? (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
            <span aria-hidden="true" className="h-[7px] w-[7px] animate-ping rounded-full bg-current" />
            Live from Stellar
          </span>
        ) : null}
      </div>

      {!contractId ? (
        <>
          <p className={`mt-4 text-[clamp(2.6rem,6vw,4rem)] leading-[0.9] text-white/70 ${FONT}`} style={{ fontVariationSettings: axes(80, 850) }}>
            Not funded yet
          </p>
          <p className="mt-3 text-sm text-white/55">The funder has not deployed the escrow for this campaign.</p>
        </>
      ) : loading ? (
        <div aria-busy="true" className="mt-4 animate-pulse">
          <span className="sr-only">Reading escrow balance from Stellar…</span>
          <div className="h-20 w-44 rounded-2xl bg-white/[0.06] md:h-24" />
          <div className="mt-5 flex gap-[3px]">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className="h-5 flex-1 rounded-[3px] bg-white/[0.06]" />
            ))}
          </div>
        </div>
      ) : balance === null ? (
        <p className="mt-4 text-lg font-semibold text-fail">Balance unavailable, check on-chain</p>
      ) : (
        <>
          <p className={`mt-3 flex items-end gap-3 text-[clamp(4.5rem,10vw,7rem)] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
            {figure(balance)}
            <small className="mb-[0.1em] font-sans text-base font-semibold leading-none text-white/55" style={{ fontVariationSettings: "normal" }}>
              USDC held
            </small>
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
                className="mt-6 flex gap-[3px]"
              >
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <span
                    key={i}
                    className={`h-5 flex-1 animate-pop rounded-[3px] ${i < lit ? "bg-accent" : "bg-white/10"}`}
                    style={{ animationDelay: `${200 + i * 30}ms` }}
                  />
                ))}
              </div>
              <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">{meter.label}</p>
            </>
          ) : null}
        </>
      )}

      <p className="mt-6 flex items-start gap-3 border-t border-white/10 pt-5 text-[14px] leading-relaxed text-white/70">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" className="mt-0.5 shrink-0 stroke-accent" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Proofwork can&apos;t move this money. Only the funder releases payouts; only a neutral resolver can return what&apos;s left.
      </p>
      {contractId ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-white/50">Escrow contract</span>
          <HashChip value={contractId} href={publicEnv.explorerContractUrl(contractId)} />
        </div>
      ) : null}
      {closed ? <RemainderReturn txHash={remainderTxHash} balance={balance} /> : null}
    </div>
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
          <span className="text-[13px] text-white/50">Remainder returned to funder</span>
          <HashChip value={txHash} href={publicEnv.explorerTxUrl(txHash)} />
        </>
      ) : (
        <span className="text-[13px] text-white/50">{balance !== null && Number(balance) === 0 ? "Nothing left to return" : "Remainder return pending"}</span>
      )}
    </div>
  );
}
