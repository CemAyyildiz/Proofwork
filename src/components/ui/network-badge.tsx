import { publicEnv } from "@/config/public-env";
import { cx } from "./cx";

/** Names the network this deployment runs on, so nobody mistakes testnet USDC for money or the reverse. */
export function NetworkBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-[7px] rounded-full bg-white/[0.06] px-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-white/65",
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 animate-ping rounded-full bg-accent text-accent" />
      {publicEnv.isMainnet ? "Mainnet" : "Testnet"}
    </span>
  );
}
