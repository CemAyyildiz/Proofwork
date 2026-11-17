import { formatUsdc } from "@/lib/format";

/** "10" from "10.0000000", with thousands separators: the figure without its unit, for display type. */
export function amount(value: string | number): string {
  return formatUsdc(value).replace(/ USDC$/, "");
}
