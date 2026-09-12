/**
 * Request-time clock for server components. A server component renders once
 * per request, so reading the time there is stable; the wrapper keeps the
 * purity lint honest about where wall-clock reads happen.
 */
export function requestNow(): number {
  return Date.now();
}
