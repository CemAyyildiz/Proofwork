import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { toStroops } from "@/escrow/amount";

/** A count, or a USDC decimal string the meter reads in stroops so no float touches the amount. */
type Quantity = number | string;

/** Whole units for the meter: counts as they are, amounts in stroops. */
function units(q: Quantity): bigint {
  if (typeof q === "number") return BigInt(Math.max(0, Math.trunc(q)));
  return /^\d+(?:\.\d{1,7})?$/.test(q) ? toStroops(q) : 0n;
}

/**
 * One funder limit as a row: its name, the figures, and a meter of what is in
 * use against the cap. The same drawing everywhere: grey up to the cap, red
 * past it. `adding` is the campaign being checked, drawn hatched after what is
 * in use, grey while it fits and red where it runs past the cap. The meter
 * stretches past the cap when usage does, with a mark at the cap; at exactly
 * the cap it is full, with a red end cap. `over` turns the figures red.
 * Amounts are compared in stroops; only the drawn widths are floats.
 * Server-safe: no hooks.
 */
export function LimitMeter({
  label,
  value,
  used,
  max,
  adding = 0,
  over,
  note,
}: {
  label: string;
  value: ReactNode;
  used: Quantity;
  max: Quantity;
  adding?: Quantity;
  over: boolean;
  note?: ReactNode;
}) {
  const u = units(used);
  const m = units(max);
  const a = units(adding);
  const end = u + a;
  const top = end > m ? end : m;
  const scale = top > 0n ? top : 1n;
  // Hundredths of a percent, computed in whole units; Number only for the width.
  const pct = (n: bigint) => `${Math.min(100, Math.max(0, Number((n * 10_000n) / scale) / 100))}%`;
  const min = (x: bigint, y: bigint) => (x < y ? x : y);
  const maxOf = (x: bigint, y: bigint) => (x > y ? x : y);
  // Stretches as [from, to) in units, each drawn only when it has width.
  const stretches: Array<{ key: string; from: bigint; to: bigint; className: string }> = [
    { key: "used", from: 0n, to: min(u, m), className: "bg-white/70" },
    { key: "used-over", from: m, to: u, className: "bg-fail" },
    { key: "adding", from: u, to: min(end, m), className: "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.7)_0_3px,transparent_3px_6px)]" },
    { key: "adding-over", from: maxOf(u, m), to: end, className: "bg-[repeating-linear-gradient(135deg,var(--color-fail)_0_3px,transparent_3px_6px)]" },
  ];
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">{label}</dt>
        <dd className={cx("text-[13.5px] font-semibold tabular-nums", over ? "text-fail" : "text-text")}>{value}</dd>
      </div>
      <div aria-hidden="true" className="relative mt-2.5 h-2.5 overflow-hidden rounded-full bg-white/10">
        {stretches.map((st) =>
          st.to > st.from ? <span key={st.key} className={cx("absolute inset-y-0 origin-left animate-grow", st.className)} style={{ left: pct(st.from), width: pct(st.to - st.from) }} /> : null,
        )}
        {/* Exactly at the cap: full, and the last sliver red, so "at the limit" reads at a glance. */}
        {end === m && m > 0n ? <span className="absolute inset-y-0 right-0 w-1.5 bg-fail" /> : null}
      </div>
      {/* The cap's mark, outside the clipped track so it can stand taller than it. */}
      {end > m ? (
        <div aria-hidden="true" className="relative -mt-[13px] h-4">
          <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-text" style={{ left: pct(m) }} />
        </div>
      ) : null}
      {note ? <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">{note}</p> : null}
    </div>
  );
}
