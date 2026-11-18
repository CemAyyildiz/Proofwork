import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * One funder limit as a row: its name, the figures, and a meter of what is in
 * use against the cap. `adding` is the campaign being checked, drawn hatched
 * after what is in use. The meter runs past the cap when usage does, with a
 * mark at the cap, and turns red once the limit is reached or exceeded.
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
  used: number;
  max: number;
  adding?: number;
  over: boolean;
  note?: ReactNode;
}) {
  const scale = Math.max(max, used + adding, Number.MIN_VALUE);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%`;
  const fill = over ? "bg-fail" : "bg-paper";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">{label}</dt>
        <dd className={cx("text-[13.5px] font-semibold tabular-nums", over ? "text-fail" : "text-text")}>{value}</dd>
      </div>
      <div aria-hidden="true" className="relative mt-2.5 h-2.5 rounded-full bg-white/10">
        <span className={cx("absolute inset-y-0 left-0 origin-left animate-grow rounded-full", fill)} style={{ width: pct(used) }} />
        {adding > 0 ? (
          <span
            className={cx(
              "absolute inset-y-0 rounded-full",
              over ? "bg-[repeating-linear-gradient(135deg,var(--color-fail)_0_3px,transparent_3px_6px)]" : "bg-[repeating-linear-gradient(135deg,#f2f0e9_0_3px,transparent_3px_6px)]",
            )}
            style={{ left: pct(used), width: pct(adding) }}
          />
        ) : null}
        {used + adding > max ? <span className="absolute -inset-y-1 w-[2px] rounded-full bg-text" style={{ left: pct(max) }} /> : null}
      </div>
      {note ? <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">{note}</p> : null}
    </div>
  );
}
