import type { ReactNode } from "react";
import { ax, figureAxes, isZero, Label } from "./kit";
import { CountUp } from "./motion-bits";

/** An operator page section: a display-face heading with an optional count pill, one line of context, then the content. */
export function Section({ id, title, count, description, children }: { id: string; title: string; count?: number; description: ReactNode; children: ReactNode }) {
  const headingId = `${id}-heading`;
  return (
    <section className="space-y-5" aria-labelledby={headingId}>
      <div className="max-w-[760px]">
        <h2 id={headingId} className="flex items-baseline gap-3 font-display text-[clamp(1.9rem,3.4vw,2.75rem)] leading-none" style={{ fontVariationSettings: ax(85, 840) }}>
          {title}
          {count !== undefined ? (
            <span className="self-center rounded-full bg-white/10 px-3 py-1 font-mono text-sm font-medium tracking-normal text-white/75" style={{ fontVariationSettings: "normal" }}>
              {count}
            </span>
          ) : null}
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-white/55">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * An operator summary figure: `hero` huge on its own, otherwise a `dt`/`dd`
 * pair for a `dl`. A zero is set wide so it reads as zero. A string value is
 * shown as given (an amount such as "1,250.5").
 */
export function Figure({ value, label, hero = false }: { value: number | string; label: string; hero?: boolean }) {
  const v = String(value);
  const tone = isZero(v) ? "text-white/45" : "text-text";
  if (hero) {
    return (
      <div className="min-w-0">
        <p className={`font-display text-[clamp(4.5rem,11vw,8.75rem)] leading-[0.8] ${tone}`} style={{ fontVariationSettings: figureAxes(v, 60, 900) }}>
          <CountUp value={v} />
        </p>
        <Label className="mt-3 tracking-[0.14em]">{label}</Label>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end">
      <dt className="mt-2.5 font-mono text-[11px] uppercase leading-snug tracking-[0.12em] text-white/60">{label}</dt>
      <dd className={`font-display text-[clamp(2.25rem,3.6vw,3rem)] leading-[0.85] ${tone}`} style={{ fontVariationSettings: figureAxes(v, 64, 900) }}>
        <CountUp value={v} />
      </dd>
    </div>
  );
}
