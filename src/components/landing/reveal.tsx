"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { canHoverFine } from "@/components/use-reduced-motion";

/** True once the element has entered the viewport (never flips back). */
export function useInView<T extends Element>(rootMargin = "0px 0px -12% 0px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, seen]);

  return [ref, seen];
}

/**
 * Rises 40px and fades in when scrolled into view. The hidden state lives in
 * globals.css behind `prefers-reduced-motion: no-preference`, so reduced-motion
 * visitors get the final state straight away.
 */
export function Reveal({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} data-reveal={seen ? "shown" : ""} className={className} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  );
}

/** Magnetic pull toward the pointer for the primary CTA. Fine pointers only, off under reduced motion. */
export function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  function onMove(e: React.PointerEvent<HTMLSpanElement>) {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || !canHoverFine()) return;
    const r = el.getBoundingClientRect();
    el.style.transition = "transform 0.4s cubic-bezier(0.2, 0.7, 0.1, 1)";
    el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)";
    el.style.transform = "";
  }

  return (
    <span ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={className ?? "inline-flex"}>
      {children}
    </span>
  );
}
