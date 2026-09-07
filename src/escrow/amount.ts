import { AppError } from "@/lib/errors";

/**
 * USDC has 7 decimals on Stellar. Inside the app amounts are decimal strings
 * so no float ever touches money. The Trustless Work API takes JS numbers;
 * conversion happens only here, with a bounds check that keeps the number
 * exactly representable.
 */
const DECIMALS = 7;
const AMOUNT_RE = /^(\d+)(?:\.(\d{1,7}))?$/;

/** Well-formed decimal, zero allowed (balances can be zero). */
export function assertAmount(s: string): void {
  if (!AMOUNT_RE.test(s)) throw new AppError("VALIDATION", `invalid amount "${s}"`);
}

/** For user-supplied amounts: rewards, budgets, distributions. */
export function assertPositiveAmount(s: string): void {
  assertAmount(s);
  if (toStroops(s) === 0n) throw new AppError("VALIDATION", "amount must be positive");
}

export function toStroops(s: string): bigint {
  assertAmount(s);
  const m = AMOUNT_RE.exec(s) as RegExpExecArray;
  const whole = m[1] as string;
  const frac = (m[2] ?? "").padEnd(DECIMALS, "0");
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt(frac);
}

export function fromStroops(n: bigint): string {
  const whole = n / 10n ** BigInt(DECIMALS);
  const frac = (n % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function addAmounts(a: string, b: string): string {
  return fromStroops(toStroops(a) + toStroops(b));
}

export function subAmounts(a: string, b: string): string {
  const r = toStroops(a) - toStroops(b);
  if (r < 0n) throw new AppError("VALIDATION", "amount underflow");
  return fromStroops(r);
}

/** For the provider API: exact as a JS number, or refuse. */
export function toApiAmount(s: string): number {
  assertPositiveAmount(s);
  const stroops = toStroops(s);
  if (stroops > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError("VALIDATION", "amount too large for provider API");
  return Number(stroops) / 10 ** DECIMALS;
}

export function fromApiAmount(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new AppError("ESCROW", `provider returned invalid amount ${n}`);
  return fromStroops(BigInt(Math.round(n * 10 ** DECIMALS)));
}
