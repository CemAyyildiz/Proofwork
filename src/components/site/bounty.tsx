"use client";

import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { axes, ease, FONT, seg, useClock, useSeen, useTrack, Y } from "@/components/e/motion";
import { cx } from "@/components/ui/cx";
import { SIGNALS } from "@/domain/rubric";

/* The moving parts of the bounty page; the page itself stays a server component. */

/**
 * The ticket column's sticky wrapper. A ticket taller than the window sticks
 * by its bottom edge instead of its top, so the submit form at its foot can
 * always be scrolled into view.
 */
export function StickyTicket({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(96);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setTop(Math.min(96, window.innerHeight - el.offsetHeight - 24));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  return (
    <div ref={ref} className="lg:sticky" style={{ top }}>
      {children}
    </div>
  );
}

/** Days, hours, minutes and seconds left, or null once the deadline has passed. */
function left(deadline: string, now: number): [string, string][] | null {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return null;
  const pad = (v: number) => String(v).padStart(2, "0");
  return [
    [pad(Math.floor(ms / 86_400_000)), "days"],
    [pad(Math.floor((ms / 3_600_000) % 24)), "hrs"],
    [pad(Math.floor((ms / 60_000) % 60)), "min"],
    [pad(Math.floor((ms / 1000) % 60)), "sec"],
  ];
}

/** The ticket's countdown, ticking every second. The UTC deadline sits under it. */
export function TicketClock({ deadline, label }: { deadline: string; label: string }) {
  const now = useClock();
  const parts = now === null ? null : left(deadline, now);
  return (
    <div>
      <div className="grid grid-cols-4 gap-2" role="timer" aria-label={`Closes ${label}`}>
        {(parts ?? [["--", "days"], ["--", "hrs"], ["--", "min"], ["--", "sec"]]).map(([v, l]) => (
          <div key={l} className="rounded-2xl bg-white/[0.06] py-3 text-center">
            <p className={`text-4xl leading-none tabular-nums ${FONT}`} style={{ fontVariationSettings: axes(70, 800) }}>
              {now !== null && parts === null ? "00" : v}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-white/45">{l}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">{label}</p>
    </div>
  );
}

function Signal({ i, s }: { i: number; s: (typeof SIGNALS)[number] }) {
  const [ref, seen] = useSeen<HTMLLIElement>();
  return (
    <li ref={ref} data-seen={seen ? "1" : "0"} className="group/sig border-b border-black/15">
      <details className="group/d">
        <summary className="flex cursor-pointer list-none items-center gap-4 py-5 sm:gap-5 [&::-webkit-details-marker]:hidden">
          <span className={`w-9 shrink-0 text-3xl leading-none text-black/25 sm:w-10 ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-[clamp(1.25rem,2.2vw,1.75rem)] leading-tight ${FONT}`} style={{ fontVariationSettings: axes(95, 750) }}>
              {s.label}
            </span>
            <span className="mt-1 block text-[15px] text-black/60">{s.question.charAt(0).toUpperCase() + s.question.slice(1)}</span>
          </span>
          <span
            className="hidden translate-y-2 rounded-full border border-black/20 px-2.5 py-1 font-mono text-[11px] text-black/55 opacity-0 transition-all duration-500 group-data-[seen=1]/sig:translate-y-0 group-data-[seen=1]/sig:opacity-100 sm:inline"
            style={{ transitionDelay: `${200 + i * 60}ms` }}
          >
            yes / no
          </span>
          <Plus className="size-5 shrink-0 text-black/40 transition-transform duration-300 group-open/d:rotate-45" aria-hidden="true" />
        </summary>
        <p className="-mt-1 mb-5 max-w-xl rounded-xl bg-black/5 p-4 text-sm leading-relaxed text-black/70 sm:ml-15">
          <span className="font-semibold text-black">Counts as no: </span>
          {s.failsWhen}
        </p>
      </details>
    </li>
  );
}

/** The six review questions, each opening to what makes it a no. */
export function ReviewQuestions() {
  return (
    <ol className="mt-8 border-t border-black/15">
      {SIGNALS.map((s, i) => (
        <Signal key={s.id} i={i} s={s} />
      ))}
    </ol>
  );
}

export interface PayoutRowData {
  shortId: string;
  amount: string;
  hash: string;
  href: string;
  ago: string;
  verify: string | null;
}

/** Yellow: everything this bounty has paid, one row per release transaction. */
export function Payouts({ payouts }: { payouts: PayoutRowData[] }) {
  const track = useRef<HTMLElement>(null);
  const big = useRef<HTMLHeadingElement>(null);
  useTrack(track, (p) => {
    // The headline narrows from wide to condensed as the section passes, the same move as the home hero.
    if (big.current) big.current.style.fontVariationSettings = axes(125 - ease(seg(p, 0, 0.5)) * 65, 900);
  });
  return (
    <section ref={track} aria-labelledby="paid-title" className="overflow-hidden px-5 py-24 text-black sm:px-6" style={{ background: Y }}>
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">Paid from this bounty</p>
        <h2 id="paid-title" ref={big} className={`mt-2 whitespace-nowrap text-[clamp(3rem,10vw,8.5rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(125, 900) }}>
          {payouts.length === 0 ? "Nobody yet." : `${payouts.length} ${payouts.length === 1 ? "payout" : "payouts"}.`}
        </h2>
        {payouts.length === 0 ? (
          <p className="mt-6 max-w-md text-lg">The first approved post here gets paid first. Every payout shows up with its transaction.</p>
        ) : (
          <ul className="mt-12 border-t-2 border-black">
            {payouts.map((p, i) => (
              <PayoutRow key={p.hash} p={p} i={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PayoutRow({ p, i }: { p: PayoutRowData; i: number }) {
  const [ref, seen] = useSeen<HTMLLIElement>();
  return (
    <li
      ref={ref}
      className={cx(
        "grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 border-b border-black/20 py-5 transition-all duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] sm:grid-cols-[auto_1fr_auto] md:grid-cols-[9rem_1fr_auto_auto] md:gap-x-6",
        seen ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0",
      )}
      style={{ transitionDelay: `${(i % 6) * 60}ms` }}
    >
      <span className={`text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
        +{p.amount}
      </span>
      <span>
        <span className="block font-semibold">Submission {p.shortId}</span>
        <span className="block text-sm text-black/60">{p.ago}</span>
      </span>
      <span className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end md:contents">
        {p.verify ? (
          <Link href={p.verify} className="inline-flex w-fit rounded-full border border-black/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-black hover:text-accent">
            Decision
          </Link>
        ) : (
          <span className="hidden md:block" />
        )}
        <a
          href={p.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-black px-4 py-2 font-mono text-xs text-white transition-transform hover:-translate-y-0.5"
        >
          {p.hash} <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      </span>
    </li>
  );
}
