import { cx } from "./cx";

/** Brand mark: a P whose stem is the long arm of a check. Decorative unless a wordmark is absent. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="8 8 86 78" className={cx("h-[21px] w-[21px] shrink-0", className)} aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="13">
        <path d="M56 16 H66 A20 20 0 0 1 66 56 H42" className="stroke-text" />
        <path d="M16 58 L32 78 L56 16" className="stroke-accent" />
      </g>
    </svg>
  );
}

export function Logo({ wordmark = true, className }: { wordmark?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.03em] text-text", className)}>
      <LogoMark />
      {wordmark ? <span>Proofwork</span> : <span className="sr-only">Proofwork</span>}
    </span>
  );
}
