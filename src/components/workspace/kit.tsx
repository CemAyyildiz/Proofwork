import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { fromStroops, toStroops } from "@/escrow/amount";

/*
 * The workspace's share of the E language: Anybody display type, mono labels,
 * big rounded panels and the escrow drawn as slots. Server-safe (no hooks), so
 * server pages and client components both use it. The animated pieces live in
 * ./motion-bits.tsx.
 */

/** Anybody's two axes as `font-variation-settings`. Same as `axes()` in components/e/motion, without the client boundary. */
export const ax = (wdth: number, wght: number): string => `"wdth" ${wdth}, "wght" ${wght}`;

/** True for a figure that reads as nothing: "0", "0.00". */
export const isZero = (value: string): boolean => Number(value.replace(/,/g, "")) === 0;

/**
 * Axes for a big figure. Condensed and black for real amounts; a zero is set
 * wide and lighter, because the heavy condensed "0" reads as a blob.
 */
export const figureAxes = (value: string, wdth = 62, wght = 900): string => (isZero(value) ? ax(118, 500) : ax(wdth, wght));

/** Mono uppercase label, the small print above every block. A colour in `className` replaces the default grey. */
export function Label({ as: Tag = "p", className, children, id }: { as?: "p" | "span" | "h2" | "h3" | "dt" | "div"; className?: string | undefined; children: ReactNode; id?: string }) {
  const coloured = /(^|\s)text-(white|black|accent|text|fail|pass|paper)/.test(className ?? "");
  return (
    <Tag id={id} className={cx("font-mono text-[11px] font-medium uppercase tracking-[0.18em]", !coloured && "text-white/55", className)}>
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

/**
 * A headline whose words rise from their line, staggered, once on load. The
 * clipping box reaches 0.2em above the line (padding, cancelled by a negative
 * margin) so a dotted capital such as "İ" keeps its dot.
 */
export function RiseWords({ text, delay = 60 }: { text: string; delay?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="-mt-[0.2em] mr-[0.22em] inline-block overflow-y-clip pb-[0.08em] pt-[0.2em] align-top last:mr-0">
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
    <Tag
      aria-label={label}
      aria-labelledby={labelledBy}
      // Light panels turn the focus ring to ink (globals.css).
      data-surface={tone === "paper" || tone === "yellow" ? tone : undefined}
      className={cx("relative rounded-[28px]", PANEL[tone], className)}
    >
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
export function SlotMeter({ total, parts, cap = 48, size = "md", stagger = true }: { total: number; parts: Slots[]; cap?: number; size?: "xs" | "sm" | "md" | "lg"; stagger?: boolean }) {
  const h = size === "lg" ? "h-10 md:h-14 rounded-md" : size === "md" ? "h-7 rounded-[5px]" : size === "sm" ? "h-4 rounded-[3px]" : "h-2 rounded-[2px]";
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

/** A well-formed positive USDC decimal string in stroops, or null. Never throws. */
export function stroopsOf(amount: string): bigint | null {
  const s = amount.trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(s)) return null;
  const n = toStroops(s);
  return n > 0n ? n : null;
}

/** How many rewards a budget pays, from the decimal strings the database holds: whole stroops, no float. */
export function slotCount(budget: string, reward: string): number {
  const b = stroopsOf(budget);
  const r = stroopsOf(reward);
  if (b === null || r === null) return 0;
  return Number(b / r);
}

/**
 * How many more rewards the escrow takes on, mirroring the approve guard in
 * services/payout.ts exactly: the balance (the funded budget less what was
 * released) must cover each unreleased payout's reward plus one reward per new
 * milestone. The close milestone is not counted: it is never released. Every
 * payout row has its milestone on chain. In stroops. The server reads the
 * chain again and stays the judge.
 */
export function freeSlots(rows: ReadonlyArray<{ payoutStatus: string | null }>, escrow: { budget: string; reward: string }): number {
  const budget = stroopsOf(escrow.budget);
  const reward = stroopsOf(escrow.reward);
  if (budget === null || reward === null) return 0;
  const started = BigInt(rows.filter((r) => r.payoutStatus !== null).length);
  const room = budget - started * reward;
  return room < 0n ? 0 : Number(room / reward);
}

/** A USDC amount as a bare figure for display type: "1,240.5". Decimal strings are grouped as text, never through a float. */
export function figure(amount: string | number): string {
  const s = typeof amount === "string" ? amount.trim() : "";
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(s);
  if (m?.[1] !== undefined) {
    const exact = fromStroops(toStroops(s));
    const [whole = "0", frac] = exact.split(".");
    return `${BigInt(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toLocaleString("en-US", { maximumFractionDigits: 7 });
}

/**
 * A detail line that never breaks inside a date, a time, a relative span or a
 * key: each " · " piece stays whole, and a longer piece keeps its last two
 * words together ("closed 13 Nov"), so nothing is orphaned. A piece that ends
 * in a shortened key ("by the resolver GDPP…3YYK") breaks only before the key.
 */
export function Pieces({ text }: { text: string }) {
  return (
    <>
      {text.split(" · ").map((piece, i) => {
        const words = piece.split(" ");
        const keyed = words.length > 1 && (words.at(-1) ?? "").includes("…");
        const cut = keyed ? -1 : -2;
        const tail = words.length > -cut ? words.slice(cut).join(" ") : piece;
        const head = words.length > -cut ? words.slice(0, cut).join(" ") : "";
        return (
          <Fragment key={i}>
            {i > 0 ? "\u00a0· " : null}
            {piece.length <= 18 || head === "" ? (
              <span className="whitespace-nowrap">{piece}</span>
            ) : keyed ? (
              <>
                <span className="whitespace-nowrap">{head}</span> <span className="whitespace-nowrap">{tail}</span>
              </>
            ) : (
              <>
                {head} <span className="whitespace-nowrap">{tail}</span>
              </>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
