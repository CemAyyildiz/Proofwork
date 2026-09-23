"use client";

import { useSyncExternalStore } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Live `matchMedia` result. The server snapshot is `serverValue`. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/**
 * True when the OS asks for less motion. The server snapshot is false; the
 * CSS rule in globals.css already stops every animation before hydration.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCE);
}

/** True only for a fine hover pointer with motion allowed: tilt and magnetic effects stay off on touch. */
export function canHoverFine(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia(REDUCE).matches;
}
