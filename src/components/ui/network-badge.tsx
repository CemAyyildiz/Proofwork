import { publicEnv } from "@/config/public-env";
import { cx } from "./cx";

/** Names the network this deployment runs on, so nobody mistakes testnet USDC for money or the reverse. */
export function NetworkBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-[7px] rounded-full border border-accent-line bg-accent-soft px-[11px] font-mono text-[11px] font-medium uppercase tracking-widest text-accent",
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
      {publicEnv.isMainnet ? "Mainnet" : "Testnet"}
    </span>
  );
}
