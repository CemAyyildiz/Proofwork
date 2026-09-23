"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True when the OS asks for less motion. The server snapshot is false; the
 * CSS rule in globals.css already stops every animation before hydration.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** True only for a fine hover pointer: tilt and magnetic effects stay off on touch. */
export function canHoverFine(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia(QUERY).matches;
}
