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

export function shortKey(k: string): string {
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
