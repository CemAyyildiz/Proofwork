import { fromStroops, toStroops } from "@/escrow/amount";
import { formatUsdc } from "@/lib/format";

/** "10" from "10.0000000", with thousands separators: the figure without its unit, for display type. */
export function amount(value: string | number): string {
  return formatUsdc(value).replace(/ USDC$/, "");
}

/** What a contributor receives of `gross` after the escrow's 0.3% protocol fee (README: 1 USDC arrives as 0.997). Decimal strings in and out. */
export function netOfFee(gross: string): string {
  const g = toStroops(gross);
  return fromStroops(g - (g * 3n) / 1000n);
}
