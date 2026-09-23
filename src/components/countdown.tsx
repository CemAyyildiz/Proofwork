"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

/** "6d 20h 14m" until `end`; "Closed" once it has passed. Pure for tests. */
export function countdownLabel(endMs: number, nowMs: number): string {
  let d = Math.max(0, endMs - nowMs);
  if (d === 0) return "Closed";
  const days = Math.floor(d / 86_400_000);
  d -= days * 86_400_000;
  const hours = Math.floor(d / 3_600_000);
  d -= hours * 3_600_000;
  const minutes = Math.floor(d / 60_000);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

function subscribe(onTick: () => void): () => void {
  const t = setInterval(onTick, TICK_MS);
  return () => clearInterval(t);
}

/** Minute-resolution clock; the snapshot only changes when the minute does. */
function nowMinute(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

/**
 * Live countdown to a UTC deadline. The server renders the fixed deadline
 * (`fallback`), so there is no hydration mismatch; the browser then counts down.
 */
export function Countdown({ deadlineAt, fallback }: { deadlineAt: string; fallback: string }) {
  const now = useSyncExternalStore(subscribe, nowMinute, () => null);
  const end = Date.parse(deadlineAt);
  return (
    <time dateTime={deadlineAt} title={fallback} className="tabular-nums">
      {now === null ? fallback : countdownLabel(end, now)}
    </time>
  );
}
