"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { useReducedMotion } from "@/components/use-reduced-motion";

/**
 * Word-brightening statement: words light up as the section scrolls past 70%
 * of the viewport. Fully lit on the server and under reduced motion.
 */
export function Statement({ plain, serif }: { plain: string; serif: string }) {
  const reduce = useReducedMotion();
  const words = [...plain.split(/\s+/).map((w) => ({ w, serif: false })), ...serif.split(/\s+/).map((w) => ({ w, serif: true }))].filter(
    (x) => x.w.length > 0,
  );
  const total = words.length;
  const [lit, setLit] = useState(total);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    function update() {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const line = window.innerHeight * 0.7;
      const p = Math.min(1, Math.max(0, (line - r.top) / Math.max(1, r.height)));
      setLit(Math.round(p * total));
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduce, total]);

  const shown = reduce ? total : lit;

  return (
    <p ref={ref} className="mt-9 max-w-[1400px] text-[clamp(34px,4.6vw,76px)] font-medium leading-[1.06] tracking-[-0.045em]">
      {words.map((x, i) => (
        <span
          key={i}
          className={cx(
            "transition-colors duration-300",
            x.serif && "font-serif font-normal italic tracking-[-0.02em]",
            i < shown ? (x.serif ? "text-accent" : "text-text") : "text-line-strong",
          )}
        >
          {x.w}
          {i < total - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
