import type { ReactNode } from "react";
import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";

export type StepState = "done" | "current" | "pending" | "fail";

/**
 * Numbered rows on the black ticket. The numbers come from a CSS counter, so
 * rows rendered by different components (X, wallet set-up, the form) count
 * on from each other without knowing about one another.
 */
export function StepList({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cx("grid gap-5 [counter-reset:pw-step]", className)}>{children}</ol>;
}

export function StepRow({ state, title, children, className }: { state: StepState; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <li className={cx("grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3.5 [counter-increment:pw-step]", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "grid size-9 place-items-center rounded-full text-[15px] leading-none transition-colors duration-300",
          FONT,
          state === "done" && "animate-pop bg-white text-black",
          state === "fail" && "animate-pop bg-fail text-black",
          state === "current" && "bg-accent text-black shadow-[0_0_0_5px_rgba(253,218,36,0.15)]",
          state === "pending" && "border border-white/15 text-white/40",
          state !== "done" && state !== "fail" && "before:content-[counter(pw-step,decimal-leading-zero)]",
        )}
        style={{ fontVariationSettings: axes(80, 850) }}
      >
        {state === "done" ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : state === "fail" ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        ) : null}
      </span>
      <div className="min-w-0 pt-1.5">
        <div className={cx("text-[15px] font-semibold leading-snug", state === "pending" && "text-white/60")}>
          {title}
          {state === "done" ? <span className="sr-only"> (done)</span> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

/** Small grey line under a step title. */
export function StepNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("mt-1 text-[13px] leading-relaxed text-white/55", className)}>{children}</p>;
}
