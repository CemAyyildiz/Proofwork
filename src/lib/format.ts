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
