"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { canHoverFine } from "@/components/use-reduced-motion";

/*
 * The motion kit behind the site's look: scroll-tracked scenes, reveal-once,
 * a ticking clock, pointer tilt. Hand-written on purpose (no animation
 * library); everything writes styles through refs, so scrolling never
 * re-renders React. Reduced motion is honoured by callers and by the global
 * rule in globals.css that stops CSS animations and transitions.
 */

/** Stellar yellow: the one action colour. */
export const Y = "#fdda24";
/** Warm paper for reading surfaces. */
export const PAPER = "#f2f0e9";
/** Anybody, the variable display face: animate it with `axes()`. */
export const FONT = "font-display";

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** Progress of `p` through the window [a, b], clamped to 0..1. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const ease = (t: number) => 1 - (1 - t) ** 3;
export const axes = (wdth: number, wght: number) => `"wdth" ${wdth.toFixed(1)}, "wght" ${wght.toFixed(0)}`;

/**
 * Calls `frame` with how far the page has scrolled through `ref` (0 when its top
 * meets the top of the viewport, 1 when its bottom meets the bottom). The work is
 * batched into one animation frame per scroll, and nothing re-renders.
 */
export function useTrack(ref: RefObject<HTMLElement | null>, frame: (p: number) => void) {
  const cb = useRef(frame);
  useLayoutEffect(() => {
    cb.current = frame;
  });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      cb.current(total > 0 ? clamp(-r.top / total) : 0);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    queue();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
    };
  }, [ref]);
}

/** True once the element is on screen; never flips back. */
export function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -15% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

let clockNow = 0;
function subscribeClock(onChange: () => void) {
  clockNow = Date.now();
  queueMicrotask(onChange);
  const id = setInterval(() => {
    clockNow = Date.now();
    onChange();
  }, 1000);
  return () => clearInterval(id);
}
/** Wall clock that ticks every second, null until the page is hydrated so server and client agree. */
export function useClock(): number | null {
  return useSyncExternalStore(subscribeClock, () => clockNow || null, () => null);
}
export function countdown(deadline: string, now: number): string {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms / 3_600_000) % 24);
  const m = Math.floor((ms / 60_000) % 60);
  const s = Math.floor((ms / 1000) % 60);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** 3D tilt and a glare toward the pointer. Fine pointers only; off under reduced motion. */
export function Tilt({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={className}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== "mouse" || !canHoverFine()) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.transition = "transform 0.15s ease-out";
        el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 10}deg) rotateY(${(x - 0.5) * 12}deg) translateZ(0)`;
        el.style.setProperty("--gx", `${x * 100}%`);
        el.style.setProperty("--gy", `${y * 100}%`);
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (!el) return;
        el.style.transition = "transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)";
        el.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}
