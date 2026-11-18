import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";

/**
 * The PASS / FAIL stamp: lands from three times its size, tilted, after
 * `delay` ms. Under reduced motion it is simply there.
 */
export function Stamp({
  outcome,
  delay = 0,
  size = "lg",
  className,
}: {
  outcome: "PASS" | "FAIL";
  delay?: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const pass = outcome === "PASS";
  return (
    // Decorative: the outcome is always said in words next to it.
    <span aria-hidden="true" className={cx("pointer-events-none inline-block -rotate-[10deg]", className)}>
      <span
        className={cx(
          "inline-block animate-in fade-in zoom-in-[3] fill-mode-both duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          "border-black text-black",
          size === "lg" ? "rounded-2xl border-[5px] px-5 py-1.5" : "rounded-lg border-[3px] px-2.5 py-0.5",
          pass ? "bg-accent" : "bg-fail",
        )}
        style={{ animationDelay: `${delay}ms` }}
      >
        <span className={cx("block leading-none", FONT, size === "lg" ? "text-[clamp(3rem,6vw,4.5rem)]" : "text-2xl")} style={{ fontVariationSettings: axes(70, 900) }}>
          {outcome}
        </span>
      </span>
    </span>
  );
}
