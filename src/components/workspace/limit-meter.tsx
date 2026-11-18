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
 * use against the cap. `adding` is the campaign being checked, drawn hatched
 * after what is in use. The meter runs past the cap when usage does, with a
 * mark at the cap; once the limit is reached the figures and the part past the
 * cap turn red. Amounts are compared in stroops; only the drawn widths are
 * floats. Server-safe: no hooks.
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
  const top = u + a > m ? u + a : m;
  const scale = top > 0n ? top : 1n;
  // Hundredths of a percent, computed in whole units; Number only for the width.
  const pct = (n: bigint) => `${Math.min(100, Math.max(0, Number((n * 10_000n) / scale) / 100))}%`;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">{label}</dt>
        <dd className={cx("text-[13.5px] font-semibold tabular-nums", over ? "text-fail" : "text-text")}>{value}</dd>
      </div>
      <div aria-hidden="true" className="relative mt-2.5 h-2.5 rounded-full bg-white/10">
        <span className={cx("absolute inset-y-0 left-0 origin-left animate-grow rounded-full", over ? "bg-white/70" : "bg-paper")} style={{ width: pct(u) }} />
        {a > 0n ? (
          <span
            className={cx(
              "absolute inset-y-0 rounded-full",
              over ? "bg-[repeating-linear-gradient(135deg,var(--color-fail)_0_3px,transparent_3px_6px)]" : "bg-[repeating-linear-gradient(135deg,#f2f0e9_0_3px,transparent_3px_6px)]",
            )}
            style={{ left: pct(u), width: pct(a) }}
          />
        ) : null}
        {u + a > m ? <span className="absolute -inset-y-1 w-[2px] rounded-full bg-text" style={{ left: pct(m) }} /> : null}
      </div>
      {note ? <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">{note}</p> : null}
    </div>
  );
}
