"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { axes, countdown, FONT, PAPER, Tilt } from "@/components/e/motion";
import { cx } from "@/components/ui/cx";
import { toStroops } from "@/escrow/amount";

export interface BountyCardData {
  slug: string;
  title: string;
  /** The funding team's approved name; null when it has none, and then nothing is shown. */
  team: string | null;
  /** Reward per approved post, as a display figure ("10"). */
  reward: string;
  budget: string;
  paid: number;
  submissions: number;
  open: boolean;
  /** ISO deadline, for the live countdown. */
  deadline: string;
  /** "in 6d 4h" or "9d ago". */
  distance: string;
  /** For a card that is not open: "Deadline passed", "Closed" or "Not funded yet". */
  status: string;
  /** For a card that is not open: the UTC date it ended or closed. */
  dateLabel: string;
}

const PLAIN = /^\d+(\.\d{1,7})?$/;

/** How many posts the budget pays for at this reward: whole posts, counted in stroops, never with float division. Takes display figures ("1,000"). */
export function slotsOf(budget: string, reward: string): number {
  const r = reward.replace(/,/g, "");
  const b = budget.replace(/,/g, "");
  if (!PLAIN.test(r) || !PLAIN.test(b)) return 0;
  const per = toStroops(r);
  return per > 0n ? Number(toStroops(b) / per) : 0;
}

/**
 * A bounty as a big card: paper when it is open, dark once it is over. The
 * slots are the posts the escrow can pay for, filled for every one already paid.
 */
export function BountyCard({ b, now, className }: { b: BountyCardData; now: number | null; className?: string }) {
  const slots = slotsOf(b.budget, b.reward);
  const shown = Math.min(slots, 30);
  return (
    <Tilt className={cx("group/card relative will-change-transform", className)}>
      <Link
        href={`/c/${b.slug}`}
        className={cx("relative flex size-full flex-col overflow-hidden rounded-[30px] p-7", b.open ? "text-black" : "bg-[#151515] text-white/75")}
        style={b.open ? { background: PAPER } : undefined}
      >
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 [background:radial-gradient(circle_at_var(--gx,50%)_var(--gy,50%),rgba(255,255,255,0.7),transparent_45%)] group-hover/card:opacity-100" />
        <div className="relative flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-semibold">{b.team ?? ""}</span>
          <span className={cx("shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] tabular-nums", b.open ? "bg-black text-accent" : "bg-white/10")}>
            {b.open ? (now ? countdown(b.deadline, now) : `closes ${b.distance}`) : b.status}
          </span>
        </div>
        <h3 className={`relative mt-6 line-clamp-3 pb-[0.06em] text-[clamp(1.8rem,2.6vw,2.4rem)] leading-[1.02] [overflow-wrap:anywhere] ${FONT}`} style={{ fontVariationSettings: axes(85, 800) }}>
          {b.title}
        </h3>
        <div className="relative mt-auto pt-7">
          <p className={`text-[clamp(5.5rem,9vw,7.5rem)] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
            {b.reward}
          </p>
          <p className="mt-2 text-sm font-semibold">USDC for every approved post</p>
          {shown > 0 ? (
            <div className="mt-5 flex gap-[3px]" aria-hidden="true">
              {Array.from({ length: shown }, (_, i) => (
                <span key={i} className={cx("h-6 flex-1 rounded-[3px]", i < b.paid ? (b.open ? "bg-black" : "bg-white/50") : b.open ? "bg-black/12" : "bg-white/10")} />
              ))}
            </div>
          ) : null}
          <div className={cx("mt-2 flex justify-between gap-3 text-xs", b.open ? "text-black/70" : "text-white/60")}>
            <span>
              {b.paid} of {slots} paid
            </span>
            <span>
              {b.submissions} {b.submissions === 1 ? "post" : "posts"} in
            </span>
          </div>
          {b.open ? (
            <span className="mt-5 flex items-center justify-between rounded-full bg-black px-5 py-3.5 text-sm font-semibold text-white transition-colors group-hover/card:bg-accent group-hover/card:text-black">
              Do this bounty <ArrowRight className="size-4 transition-transform group-hover/card:translate-x-1" />
            </span>
          ) : (
            <span className="mt-5 block border-t border-white/10 pt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-white/55">
              {b.status} · {b.dateLabel}
            </span>
          )}
        </div>
      </Link>
    </Tilt>
  );
}
