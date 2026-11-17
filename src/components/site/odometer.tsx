"use client";

/** A figure whose digits roll up from 0 once `seen` turns true. Non-digits stay put. */
export function Odometer({ value, seen }: { value: string; seen: boolean }) {
  return (
    <span className="inline-flex" aria-label={value} role="img">
      {[...value].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} aria-hidden="true" className="inline-block h-[0.86em] overflow-hidden">
            <span
              className="flex flex-col transition-transform duration-[1800ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: `translateY(${seen ? -Number(ch) * 10 : 0}%)`, transitionDelay: `${i * 90}ms` }}
            >
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d} className="h-[0.86em] leading-[0.86]">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} aria-hidden="true">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
