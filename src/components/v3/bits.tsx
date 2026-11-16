import { cn } from "@/lib/utils";

/** Six calm hues; a name always lands on the same one. */
const HUES = [
  "bg-[#ffe9a8] text-[#5c4300]",
  "bg-[#d7e8ff] text-[#0b3a75]",
  "bg-[#dff3e3] text-[#14532d]",
  "bg-[#ffdcd2] text-[#7a2413]",
  "bg-[#e9e0ff] text-[#3f2a86]",
  "bg-[#d9f2f2] text-[#0f4c4c]",
] as const;

function hue(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length] ?? HUES[0];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

/** A team's tile: its initials on its own colour. Stands in until teams upload a logo. */
export function TeamAvatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "size-14 rounded-xl text-lg" : size === "sm" ? "size-7 rounded-md text-[11px]" : "size-11 rounded-lg text-sm";
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center font-semibold", box, hue(name), className)}>
      {initials(name)}
    </span>
  );
}

/** The USDC mark: a blue coin. Drawn here so no image is fetched from a third party. */
export function UsdcIcon({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-5 shrink-0", className)}>
      <circle cx="12" cy="12" r="12" fill="#2775ca" />
      <path
        fill="#fff"
        d="M12.9 6.2v1.1c1.5.2 2.5 1.1 2.6 2.4h-1.6c-.1-.6-.6-1-1.4-1.1v2.7l.5.1c1.9.4 2.8 1.200 2.800 2.700 0 1.600-1.200 2.600-3.200 2.800v1.100h-1.200v-1.100c-1.800-.2-2.900-1.200-3-2.700h1.700c.1.700.700 1.200 1.700 1.300v-2.900l-.4-.1c-1.800-.4-2.700-1.200-2.700-2.600 0-1.500 1.100-2.500 2.900-2.700V6.200h1.300Zm-1.200 2.400c-.8.100-1.300.500-1.300 1.100 0 .600.400.900 1.300 1.100V8.600Zm1.200 7c.9-.100 1.400-.500 1.400-1.200 0-.600-.400-1-1.400-1.200v2.400Z"
      />
    </svg>
  );
}

export function Usdc({ amount, className, iconClassName }: { amount: string; className?: string; iconClassName?: string | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-semibold tabular-nums", className)}>
      <UsdcIcon className={iconClassName} />
      {amount}
      <span className="font-normal text-muted-foreground">USDC</span>
    </span>
  );
}

/** "10" from "10.0000000": the number alone, for use beside the USDC mark. */
export function plainAmount(amount: string): string {
  const [whole, frac = ""] = amount.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}
