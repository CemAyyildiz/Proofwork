import { cx } from "./cx";

export function TestnetBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-[7px] rounded-full border border-accent-line bg-accent-soft px-[11px] font-mono text-[11px] font-medium uppercase tracking-widest text-accent",
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
      Testnet
    </span>
  );
}
