/** Display helpers. Amounts stay strings everywhere else; this is presentation only. */
export function formatUsdc(amount: string | number): string {
  const s = String(amount);
  const [whole, frac = ""] = s.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${trimmed ? "." + trimmed : ""} USDC`;
}

export function formatDate(d: Date): string {
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

/**
 * Keeps `head` leading and `tail` trailing characters around an ellipsis.
 * A value that would not get shorter is returned unchanged.
 */
export function truncateMiddle(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ""}`;
}

/** Wallet address, 4 + 4. */
export function shortKey(k: string): string {
  return truncateMiddle(k, 4, 4);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Short UTC date for public pages, e.g. "2 Oct · 18:00 UTC" (EXPERIENCE.md voice). */
export function formatDateShort(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * Escrow budget meter for the contributor page: the share of the budget still
 * held, clamped to 0–100. Null when the balance could not be read or there is
 * no budget, so the page shows no meter rather than a guess.
 */
export function budgetMeter(balance: string | null, budget: string): { pct: number; label: string } | null {
  const total = Number(budget);
  if (balance === null || !(total > 0)) return null;
  const left = Number(balance);
  const pct = Math.min(100, Math.max(0, (left / total) * 100));
  return { pct, label: `${formatUsdc(balance).replace(/ USDC$/, "")} of ${formatUsdc(budget)} left` };
}
