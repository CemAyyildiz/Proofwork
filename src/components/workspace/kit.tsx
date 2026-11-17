import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/*
 * The workspace's share of the E language: Anybody display type, mono labels,
 * big rounded panels and the escrow drawn as slots. Server-safe (no hooks), so
 * server pages and client components both use it. The animated pieces live in
 * ./motion-bits.tsx.
 */

/** Anybody's two axes as `font-variation-settings`. Same as `axes()` in components/e/motion, without the client boundary. */
export const ax = (wdth: number, wght: number): string => `"wdth" ${wdth}, "wght" ${wght}`;

/** Mono uppercase label, the small print above every block. A colour in `className` replaces the default grey. */
export function Label({ as: Tag = "p", className, children, id }: { as?: "p" | "span" | "h2" | "h3" | "dt" | "div"; className?: string | undefined; children: ReactNode; id?: string }) {
  const coloured = /(^|\s)text-(white|black|accent|text|fail|pass|paper)/.test(className ?? "");
  return (
    <Tag id={id} className={cx("font-mono text-[11px] font-medium uppercase tracking-[0.18em]", !coloured && "text-white/50", className)}>
      {children}
    </Tag>
  );
}

/** Display-face text: condensed and heavy for figures, wider for headings. */
export function Display({
  as: Tag = "span",
  wdth = 70,
  wght = 900,
  className,
  style,
  children,
}: {
  as?: "span" | "p" | "h1" | "h2" | "h3";
  wdth?: number;
  wght?: number;
  className?: string | undefined;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Tag className={cx("font-display", className)} style={{ fontVariationSettings: ax(wdth, wght), ...style }}>
      {children}
    </Tag>
  );
}

/** A headline whose words rise from their line, staggered, once on load. */
export function RiseWords({ text, delay = 60 }: { text: string; delay?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="mr-[0.22em] inline-block overflow-y-clip pb-[0.08em] align-top last:mr-0">
          <span className="inline-block animate-rise" style={{ animationDelay: `${delay + i * 45}ms` }}>
            {w}
          </span>
        </span>
      ))}
    </>
  );
}

export type PanelTone = "dark" | "raised" | "paper" | "yellow";

const PANEL: Record<PanelTone, string> = {
  dark: "bg-[#0e0e0e] border border-white/[0.07] text-text",
  raised: "bg-[#141414] border border-white/[0.08] text-text",
  paper: "bg-paper text-paper-ink",
  yellow: "bg-accent text-accent-ink",
};

/** The workspace card: big radius, no hairline grid. */
export function Panel({
  tone = "dark",
  className,
  children,
  as: Tag = "div",
  label,
  labelledBy,
}: {
  tone?: PanelTone;
  className?: string | undefined;
  children: ReactNode;
  as?: "div" | "section" | "aside";
  label?: string;
  labelledBy?: string;
}) {
  return (
    <Tag aria-label={label} aria-labelledby={labelledBy} className={cx("relative rounded-[28px]", PANEL[tone], className)}>
      {children}
    </Tag>
  );
}

/** One stretch of the escrow meter. */
export interface Slots {
  key: "paid" | "signature" | "ready" | "review" | "left";
  n: number;
  label: string;
}

/** Fill per slot kind. Paid is the yellow of money that moved; approved-and-waiting is yellow hatched; the rest step down to empty. */
export const SLOT_FILL: Record<Slots["key"], string> = {
  paid: "bg-accent",
  signature: "bg-[repeating-linear-gradient(135deg,#fdda24_0_4px,#fdda2455_4px_8px)]",
  ready: "bg-paper",
  review: "bg-white/25",
  left: "border border-white/15",
};

/**
 * The escrow drawn as one slot per reward it can pay: paid, approved and
 * waiting for a signature, passed and ready to approve, in review, still free.
 * Past `cap` slots the run is drawn as proportional bars instead.
 */
export function SlotMeter({ total, parts, cap = 48, size = "md", stagger = true }: { total: number; parts: Slots[]; cap?: number; size?: "sm" | "md" | "lg"; stagger?: boolean }) {
  const h = size === "lg" ? "h-10 md:h-14 rounded-md" : size === "md" ? "h-7 rounded-[5px]" : "h-4 rounded-[3px]";
  const used = parts.filter((p) => p.key !== "left").reduce((s, p) => s + p.n, 0);
  const slots = Math.max(total, used);
  if (slots === 0) return <div aria-hidden="true" className={cx("w-full border border-dashed border-white/15", h)} />;
  if (slots > cap) {
    return (
      <div aria-hidden="true" className={cx("flex w-full gap-[3px] overflow-hidden", h)}>
        {parts.map((p) =>
          p.n > 0 ? <span key={p.key} className={cx("h-full origin-left animate-grow first:rounded-l-[inherit] last:rounded-r-[inherit]", SLOT_FILL[p.key])} style={{ flexGrow: p.n }} /> : null,
        )}
      </div>
    );
  }
  const cells: Slots["key"][] = parts.flatMap((p) => Array.from({ length: p.n }, () => p.key));
  return (
    <div aria-hidden="true" className="flex w-full gap-[3px]">
      {cells.slice(0, slots).map((k, i) => (
        <span key={i} className={cx("min-w-0 flex-1", h, SLOT_FILL[k], stagger && "animate-pop")} style={stagger ? { animationDelay: `${150 + i * 18}ms` } : undefined} />
      ))}
    </div>
  );
}

/** The meter's key: a swatch, the count and the word, for the kinds that have any. */
export function SlotLegend({ parts, className }: { parts: Slots[]; className?: string | undefined }) {
  return (
    <ul className={cx("flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white/55", className)}>
      {parts
        .filter((p) => p.n > 0)
        .map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx("size-2.5 rounded-[3px]", SLOT_FILL[p.key])} />
            <span className={p.key === "paid" ? "text-accent" : undefined}>{`${p.n} ${p.label}`}</span>
          </li>
        ))}
    </ul>
  );
}

/** How many rewards a budget pays, from the decimal strings the database holds. */
export function slotCount(budget: string, reward: string): number {
  const b = Number(budget);
  const r = Number(reward);
  if (!Number.isFinite(b) || !Number.isFinite(r) || r <= 0) return 0;
  return Math.max(0, Math.floor(b / r + 1e-9));
}

/** A USDC amount as a bare figure for display type: "1,240.5". */
export function figure(amount: string | number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toLocaleString("en-US", { maximumFractionDigits: 7 });
}
