"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useSeen } from "@/components/e/motion";
import { cx } from "@/components/ui/cx";

const REDUCE = "(prefers-reduced-motion: reduce)";

/**
 * A figure that counts up from zero once, the first time it is on screen.
 * The server renders the final value, so the markup always carries the real
 * number; under reduced motion it never moves.
 */
export function CountUp({ value, ms = 900, className }: { value: string; ms?: number; className?: string | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia(REDUCE).matches) return;
    const clean = value.replace(/,/g, "");
    const target = Number(clean);
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = clean.includes(".") ? (clean.split(".")[1]?.length ?? 0) : 0;
    const show = (n: number) => {
      el.textContent = n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };
    let raf = 0;
    let start = 0;
    const run = () => {
      show(0);
      const tick = (now: number) => {
        if (!start) start = now;
        const t = Math.min(1, (now - start) / ms);
        show(target * (1 - (1 - t) ** 3));
        if (t < 1) raf = requestAnimationFrame(tick);
        else el.textContent = value;
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.textContent = value;
    };
  }, [value, ms]);
  return (
    <span ref={ref} className={cx("tabular-nums", className)}>
      {value}
    </span>
  );
}

/** Slides in once when it first scrolls into view. Under reduced motion it is simply there. */
export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string | undefined; delay?: number; as?: "div" | "li" }) {
  const [ref, seen] = useSeen<HTMLDivElement & HTMLLIElement>();
  return (
    <Tag
      ref={ref}
      data-seen={seen ? "1" : "0"}
      className={cx("transition-[opacity,translate] duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] motion-safe:data-[seen=0]:translate-y-4 motion-safe:data-[seen=0]:opacity-0", className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
