"use client";

import { useState } from "react";
import { evaluate, PASS_THRESHOLD, SIGNALS, type Outcome, type ReasonCode, type Signals } from "@/domain/rubric";
import { axes, FONT } from "@/components/e/motion";
import { Stamp } from "@/components/site/stamp";
import { cx } from "@/components/ui/cx";

const ALL_PASS = Object.fromEntries(SIGNALS.map((s) => [s.id, true])) as Signals;

/**
 * The playground's verdict. The rule is `evaluate()` from the domain, the same
 * one the review service enforces; on FAIL it shows the first failed signal's
 * code, one of the reasons a reviewer could pick.
 */
export function verdictFor(signals: Signals): { outcome: Outcome; passCount: number; reason: ReasonCode } {
  const { outcome, passCount, failed } = evaluate(signals);
  const first = SIGNALS.find((s) => s.id === failed[0]);
  return { outcome, passCount, reason: outcome === "PASS" || !first ? "R00_PASS" : first.failCode };
}

/** The six review questions as yes/no switches, scored by the real rule, on paper. */
export function RubricPlayground() {
  const [signals, setSignals] = useState<Signals>(ALL_PASS);
  const v = verdictFor(signals);

  return (
    <div className="text-black">
      <ul className="border-t border-black/15">
        {SIGNALS.map((s, i) => {
          const on = signals[s.id];
          return (
            <li key={s.id} className="border-b border-black/15">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setSignals((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                className="group flex min-h-14 w-full items-center gap-4 py-3 text-left"
              >
                <span className={`w-8 shrink-0 text-2xl leading-none text-black/25 ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={cx("flex-1 text-[16px] font-semibold transition-colors", !on && "text-black/45 line-through decoration-black/30")}>{s.label}</span>
                <span className="relative grid h-8 w-[5.5rem] shrink-0 grid-cols-2 rounded-full bg-black/8 p-1 font-mono text-[11px] font-semibold">
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                      on ? "translate-x-0 bg-black" : "translate-x-full bg-fail",
                    )}
                  />
                  <span className={cx("relative grid place-items-center transition-colors", on ? "text-accent" : "text-black/40")}>YES</span>
                  <span className={cx("relative grid place-items-center transition-colors", on ? "text-black/40" : "text-black")}>NO</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div aria-live="polite" className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className={`text-[5.5rem] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
            <span key={v.passCount} className="inline-block animate-pop">
              {v.passCount}
            </span>
            <span className="text-black/25">/{SIGNALS.length}</span>
          </p>
          <div aria-hidden="true" className="mt-3 flex gap-1">
            {SIGNALS.map((s) => (
              <span key={s.id} className={cx("h-2 w-6 rounded-full transition-colors duration-300 sm:w-8", signals[s.id] ? "bg-black" : "bg-fail")} />
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-black/55">
            {PASS_THRESHOLD} of {SIGNALS.length} to pass · {v.reason}
          </p>
        </div>
        <Stamp key={v.outcome} outcome={v.outcome} className="mb-2 mr-2" />
      </div>
    </div>
  );
}
