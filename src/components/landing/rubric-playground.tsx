"use client";

import { useState } from "react";
import { evaluate, PASS_THRESHOLD, SIGNALS, type Outcome, type ReasonCode, type Signals } from "@/domain/rubric";
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

export function RubricPlayground() {
  const [signals, setSignals] = useState<Signals>(ALL_PASS);
  const v = verdictFor(signals);
  const pass = v.outcome === "PASS";

  return (
    <div>
      <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
        {SIGNALS.map((s) => {
          const on = signals[s.id];
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSignals((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
              className={cx(
                "flex min-h-[58px] items-center justify-between gap-3 rounded-lg border py-3 pl-[18px] pr-3.5 text-left text-[15px] transition-colors duration-300",
                on ? "border-line bg-sunken hover:border-line-strong" : "border-fail-line bg-fail-soft",
              )}
            >
              <span>{s.label}</span>
              <span className="flex items-center gap-2.5">
                <span className={cx("font-mono text-[11px] font-medium tracking-[0.06em]", on ? "text-pass" : "text-fail")}>{on ? "PASS" : "FAIL"}</span>
                <span
                  aria-hidden="true"
                  className={cx("relative h-[26px] w-11 shrink-0 rounded-full transition-colors duration-300", on ? "bg-pass" : "bg-line-strong")}
                >
                  <span
                    className={cx(
                      "absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-text transition-transform duration-300 ease-expo",
                      on && "translate-x-[18px]",
                    )}
                  />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-live="polite"
        className="mt-[22px] flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-line-strong bg-sunken px-5 py-[22px] sm:px-6"
      >
        <div>
          <p className="text-[56px] font-semibold leading-none tracking-[-0.06em] md:text-[64px]">
            <span key={v.passCount} className="inline-block animate-reveal [animation-duration:0.4s]">
              {v.passCount}
            </span>
            <small className="text-2xl tracking-[-0.02em] text-muted"> / {SIGNALS.length}</small>
          </p>
          <div aria-hidden="true" className="mt-2.5 flex gap-[5px]">
            {SIGNALS.map((s) => (
              <span key={s.id} className={cx("h-1.5 w-5 rounded-[3px] transition-colors duration-300 sm:w-[34px]", signals[s.id] ? "bg-pass" : "bg-fail")} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {PASS_THRESHOLD} of {SIGNALS.length} needed to pass
          </p>
        </div>
        <div className="text-right">
          <p className={cx("text-[34px] font-semibold tracking-[-0.05em] transition-colors duration-300 sm:text-[40px] md:text-[44px]", pass ? "text-pass" : "text-fail")}>
            {v.outcome}
          </p>
          <p className="mt-1 font-mono text-xs font-medium tracking-widest text-muted">{v.reason}</p>
        </div>
      </div>
    </div>
  );
}
