"use client";

import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { axes, clamp, ease, FONT, useClock, useSeen, useTrack } from "@/components/e/motion";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { cx } from "@/components/ui/cx";
import { SIGNALS } from "@/domain/rubric";

/* The moving parts of the bounty page; the page itself stays a server component. */

/** Clear of the floating nav (top-4 plus its 56px pill) with a little air. */
const BELOW_NAV = 96;

/**
 * The ticket column's sticky wrapper. A ticket that fits under the nav sticks
 * there, never higher. One too tall for the window does not stick at all: it
 * scrolls with the page, so no part of it is held under the nav and the submit
 * form at its foot can always be scrolled into view.
 */
export function StickyTicket({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setFits(window.innerHeight - el.offsetHeight - 24 >= BELOW_NAV);
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
    <div ref={ref} className={fits ? "lg:sticky" : undefined} style={{ top: BELOW_NAV }}>
      {children}
    </div>
  );
}

/**
 * The phone's bottom bar on an open bounty: the contributor's next step, one
 * tap from the ticket. It steps aside while the hero's button, the ticket
 * itself or the yellow payouts section is on screen (`data-bar-hide`), so a
 * view never holds two yellow buttons.
 */
export function SubmitBar({ label }: { label: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const els = Array.from(document.querySelectorAll("[data-bar-hide]"));
    const inView = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inView.add(e.target);
        else inView.delete(e.target);
      }
      setHidden(inView.size > 0);
    });
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      inert={hidden}
      className={cx(
        "pw-submit-bar fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black p-3 pb-[max(12px,env(safe-area-inset-bottom))] transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] lg:hidden",
        hidden ? "translate-y-full" : "translate-y-0",
      )}
    >
      <a href="#submit" className="flex h-13 items-center justify-center gap-2 rounded-full bg-accent px-5 text-center font-semibold text-black">
        {label} <span aria-hidden="true">↓</span>
      </a>
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
          <div key={l} className="rounded-2xl bg-white/[0.06] py-2.5 text-center">
            <p className={`text-4xl leading-none tabular-nums ${FONT}`} style={{ fontVariationSettings: axes(70, 800) }}>
              {now !== null && parts === null ? "00" : v}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-white/55">{l}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">{label}</p>
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

/** Yellow: everything this bounty has paid, one row per release transaction. `fee` says what one reward arrives as. */
export function Payouts({ payouts, fee }: { payouts: PayoutRowData[]; fee: { gross: string; net: string } }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLElement>(null);
  const big = useRef<HTMLHeadingElement>(null);
  useTrack(track, () => {
    // The headline narrows from wide to condensed as the section comes up the screen, the same move as the home hero.
    // Progress is how far the section's top has risen, so it also runs when the section is shorter than the screen.
    // Phones start condensed: wide type there runs past the edge.
    const sec = track.current;
    if (!big.current || !sec) return;
    const from = reduced || window.innerWidth < 640 ? 60 : 125;
    const p = clamp((window.innerHeight - sec.getBoundingClientRect().top) / (window.innerHeight * 0.8));
    big.current.style.fontVariationSettings = axes(from - ease(p) * (from - 60), 900);
  });
  return (
    <section ref={track} data-bar-hide aria-labelledby="paid-title" className="overflow-hidden bg-accent px-5 py-24 text-black sm:px-6">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/65">Released from this escrow</p>
        <h2 id="paid-title" ref={big} className={`mt-2 text-[clamp(3rem,10vw,8.5rem)] leading-[0.85] sm:whitespace-nowrap ${FONT}`} style={{ fontVariationSettings: axes(60, 900) }}>
          {payouts.length === 0 ? "Nobody yet." : `${payouts.length} ${payouts.length === 1 ? "payout" : "payouts"}.`}
        </h2>
        {payouts.length === 0 ? (
          <p className="mt-6 max-w-md text-lg">The first approved post here gets paid first. Every payout shows up with its transaction.</p>
        ) : (
          <>
            <p className="mt-6 max-w-lg text-[15px] text-black/70">
              Each row is the amount released. The escrow takes its 0.3% protocol fee on the way out, so a {fee.gross} USDC release reaches the
              contributor as {fee.net}.
            </p>
            <ul className="mt-10 border-t-2 border-black">
              {payouts.map((p, i) => (
                <PayoutRow key={p.hash} p={p} i={i} />
              ))}
            </ul>
          </>
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
        <span className="block text-sm text-black/65">USDC released · {p.ago}</span>
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
