import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";

/**
 * Closed campaign: what was left in escrow went back to the funder. The hash
 * is recorded only after the resolver's withdraw confirms, so until then the
 * return is shown as pending, never as done.
 */
export function RemainderReturn({ txHash }: { txHash: string | null }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {txHash ? (
        <>
          <span className="text-[13px] text-muted">Remainder returned to funder</span>
          <HashChip value={txHash} href={publicEnv.explorerTxUrl(txHash)} />
        </>
      ) : (
        <span className="text-[13px] text-muted">Remainder return pending</span>
      )}
    </div>
  );
}
