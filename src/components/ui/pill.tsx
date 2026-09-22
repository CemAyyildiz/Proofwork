import { cx } from "./cx";

export type PillTone = "pass" | "fail" | "wait" | "chain";

const tones: Record<PillTone, string> = {
  pass: "text-pass bg-pass-soft border-pass-line",
  fail: "text-fail bg-fail-soft border-fail-line",
  wait: "text-muted bg-white/3 border-line-strong",
  chain: "text-accent bg-accent-soft border-accent-line",
};

/** Status pill. Always a dot plus a word: status is never carried by colour alone. */
export function Pill({ tone, children, className }: { tone: PillTone; children: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-full border px-[11px] font-mono text-[11.5px] font-medium tracking-[0.05em]",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
