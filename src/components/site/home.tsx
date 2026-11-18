"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { axes, clamp, ease, FONT, PAPER, seg, useClock, useSeen, useTrack, Y } from "@/components/e/motion";
import { BountyCard, type BountyCardData } from "./bounty-card";
import { MoneyFlow } from "./money-flow";
import { amount, netOfFee } from "./amount";
import { Odometer } from "./odometer";
import { EVIDENCE_TXS } from "@/components/landing/evidence";
import { RubricPlayground } from "@/components/landing/rubric-playground";
import { VerifyPlayground } from "@/components/landing/verify-playground";
import { canHoverFine, useMediaQuery, useReducedMotion } from "@/components/use-reduced-motion";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
import { fromStroops, toStroops } from "@/escrow/amount";
import { truncateMiddle } from "@/lib/format";

export interface HomePayout {
  amount: string;
  campaign: string;
  slug: string;
  hash: string;
  href: string;
  ago: string;
}

export interface HomeData {
  network: string;
  /** Null when the totals could not be read: the ledger is left out rather than showing zeros. */
  totals: { paid: string; payouts: number; decisions: number; campaigns: number } | null;
  payouts: HomePayout[];
  bounties: BountyCardData[];
  /** The hero and closing action, by role: campaigns for a funder, the queue for a reviewer, the bounty list otherwise. */
  cta: { href: string; label: string };
}

/* ───────────────────────────── 1. hero: a stream of real receipts flying at you ───────────────────────────── */

const LINES = ["POST IT.", "PROVE IT.", "GET PAID."];
const SPAN = 3600;

function Hero({ data }: { data: HomeData }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLSpanElement | null)[]>([]);
  const fade = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);

  // Every card is a real payout: with none yet, nothing flies rather than a made-up receipt.
  const n = data.payouts.length > 0 ? 18 : 0;
  const fly = Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996;
    const r = 26 + ((i * 37) % 19);
    // Kept to the sides: a card straight above or below the centre would cross the headline and the copy under it.
    const x = Math.cos(a) * r;
    const side = Math.sign(x) || 1;
    return { x: side * Math.max(Math.abs(x), 24), y: Math.sin(a) * r * 0.62, z: (i / n) * SPAN, ry: Math.cos(a) * -18, payout: data.payouts[i % data.payouts.length], kind: i % 3 };
  });

  useEffect(() => {
    let raf = 0;
    let visible = true;
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    const t0 = performance.now();
    const onPointer = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
    };
    const loop = (now: number) => {
      raf = 0;
      const el = track.current;
      if (!el || !visible) return;
      const r = el.getBoundingClientRect();
      const p = clamp(-r.top / (r.height - window.innerHeight));
      const t = reduced ? 0 : (now - t0) / 1000;
      px += (tx - px) * 0.05;
      py += (ty - py) * 0.05;

      lines.current.forEach((line, i) => {
        if (!line) return;
        const s = ease(seg(p, 0.02, 0.6));
        const dir = i === 1 ? 1 : -1;
        line.style.transform = reduced ? "" : `translate3d(${dir * s * (18 + i * 8)}vw, 0, 0)`;
        line.style.fontVariationSettings = axes(reduced ? 112 : 112 - s * 62, 900);
      });
      if (fade.current) fade.current.style.opacity = String(1 - seg(p, 0.05, 0.3));
      if (stage.current) stage.current.style.perspectiveOrigin = `${50 + px * 14}% ${45 + py * 14}%`;

      cards.current.forEach((card, i) => {
        const f = fly[i];
        if (!card || !f) return;
        // Less motion asked for: each card holds its starting depth; scrolling does not fly them.
        const z = ((((f.z + (reduced ? 0 : t * 140 + p * 2600)) % SPAN) + SPAN) % SPAN) - 3000;
        const o = clamp((z + 3000) / 1400) * (1 - clamp((z - 150) / 350));
        card.style.transform = `translate3d(${f.x}vw, ${f.y}vh, ${z}px) rotateY(${f.ry}deg)`;
        card.style.opacity = o.toFixed(3);
      });
      if (!reduced) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? false;
      if (visible && !raf) raf = requestAnimationFrame(loop);
    });
    if (track.current) io.observe(track.current);
    // Under reduced motion the loop draws one still frame and stops: no pointer parallax, no frames on scroll.
    if (!reduced) window.addEventListener("pointermove", onPointer, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
    };
    // `fly` is derived from props that never change after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <section ref={track} aria-label="Proofwork" className="relative h-[230vh] bg-canvas text-white">
      <div className="sticky top-0 h-screen overflow-hidden">
        <div ref={stage} aria-hidden="true" className="absolute inset-0 [perspective:900px] [transform-style:preserve-3d]">
          {fly.map((f, i) => (
            <div
              key={i}
              ref={(el) => {
                cards.current[i] = el;
              }}
              className="absolute left-1/2 top-1/2 -ml-[120px] -mt-[70px] w-[240px] opacity-0 will-change-transform"
            >
              {f.payout ? <FlyCard kind={f.kind} payout={f.payout} /> : null}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(7,7,7,0.55)_45%,#070707_80%)]" />
        {/* A scrim under the copy and buttons, so no receipt card ever sits behind words you have to read. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] bg-[linear-gradient(to_top,#070707_0%,#070707_45%,rgba(7,7,7,0.85)_70%,transparent)]" />

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 pt-10 text-center">
          <div ref={fade} className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">
            <span className="size-1.5 animate-ping rounded-full text-accent" style={{ background: Y }} />
            Bounties on {data.network}
          </div>
          {/* On a phone the cards fly right through the headline: a dark band keeps a yellow receipt from sitting under "GET PAID.". */}
          <h1 className="relative isolate w-full before:pointer-events-none before:absolute before:-inset-x-4 before:-inset-y-10 before:-z-10 before:bg-[linear-gradient(to_bottom,transparent,rgba(7,7,7,0.9)_20%,rgba(7,7,7,0.9)_80%,transparent)] md:before:hidden">
            {LINES.map((l, i) => (
              <span key={l} className="block w-full overflow-x-visible overflow-y-clip py-[0.02em]">
                <span
                  ref={(el) => {
                    lines.current[i] = el;
                  }}
                  className={`block animate-rise whitespace-nowrap text-[clamp(3.4rem,13vw,12.5rem)] leading-[0.86] will-change-transform ${FONT}`}
                  style={{ animationDelay: `${120 + i * 110}ms`, fontVariationSettings: axes(112, 900), color: i === 2 ? Y : undefined }}
                >
                  {l}
                </span>
              </span>
            ))}
          </h1>
          {/* Its own dark pool: whatever card flies past, the copy and buttons sit on black. */}
          <div className="relative isolate mt-10 flex animate-reveal flex-col items-center gap-6 [animation-delay:700ms] before:pointer-events-none before:absolute before:-inset-x-[40vw] before:-inset-y-10 before:-z-10 before:bg-[radial-gradient(closest-side,#070707_55%,rgba(7,7,7,0.85)_75%,transparent)] md:before:-inset-x-48">
            <p className="max-w-md text-balance text-[15px] leading-relaxed text-white/65">
              Teams post bounties. You post the work on X. A person reviews it, and the escrow pays you on Stellar.
              {data.payouts.length > 0 ? " Every receipt here is a real transaction." : ""}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href={data.cta.href} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black transition-transform hover:scale-[1.03]">
                {data.cta.label} <ArrowRight className="size-4" />
              </Link>
              <a href="#verify" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold transition-colors hover:bg-white hover:text-black">
                Check a real decision
              </a>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-6 z-10 flex justify-center font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">
          <span className="flex animate-pulse items-center gap-2">
            Scroll <ArrowDown className="size-3" />
          </span>
        </div>
      </div>
    </section>
  );
}

function FlyCard({ kind, payout }: { kind: number; payout: HomePayout }) {
  if (kind === 0)
    return (
      <div className="rounded-2xl p-4 text-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" style={{ background: Y }}>
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-black/60">
          <span>Released</span>
          <span>{payout.ago}</span>
        </div>
        <p className={`mt-2 text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
          +{payout.amount}
        </p>
        <p className="mt-1 truncate text-xs font-semibold">USDC · {payout.campaign}</p>
        <p className="mt-3 font-mono text-[10px] text-black/60">tx {payout.hash}</p>
      </div>
    );
  if (kind === 1)
    return (
      <div className="rounded-2xl border border-white/10 bg-[#141414] p-4 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2">
          <span className="size-7 rounded-full bg-[conic-gradient(from_200deg,#fdda24,#f2f0e9,#555,#fdda24)]" />
          <div className="text-xs">
            <p className="font-semibold">Contributor</p>
            <p className="text-white/45">on X</p>
          </div>
          <span className="ml-auto text-sm font-black">X</span>
        </div>
        <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-white/80">Posted for &ldquo;{payout.campaign}&rdquo;.</p>
      </div>
    );
  return (
    <div className="rounded-2xl p-4 text-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" style={{ background: PAPER }}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-black px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-accent">PASS</span>
        <span className="truncate text-xs font-semibold">{payout.campaign}</span>
      </div>
      <p className="mt-3 text-xs text-black/60">
        {PASS_THRESHOLD} of {SIGNALS.length} yes to pass. Reviewed by a person, recorded on chain.
      </p>
    </div>
  );
}

/* ───────────────────────────── 2. the life of one post ───────────────────────────── */

/** A display figure ("1,000.5") split into the escrow's 0.3% fee and what reaches the wallet, in stroops; null for anything that is not a plain amount. */
function feeSplit(display: string): { fee: string; net: string } | null {
  const gross = display.replace(/,/g, "");
  if (!/^\d+(\.\d{1,7})?$/.test(gross)) return null;
  const net = netOfFee(gross);
  return { fee: amount(fromStroops(toStroops(gross) - toStroops(net))), net: amount(net) };
}

const STEPS = [
  { t: "Post it on X.", d: "Pick a bounty, do the work, and post about it from your own account. Paste the link into the bounty." },
  { t: "Machines check the boring part.", d: "A public x.com status link, written by the X account you connected, never submitted before, and sent while the bounty is open." },
  { t: "A person reads it.", d: `A reviewer answers six yes/no questions about the post. ${PASS_THRESHOLD} yeses pass it, and the funding team gives the final approval.` },
  { t: "The decision goes on chain.", d: "The answers and the reason are recorded on Stellar before a single cent moves. Disagree? You can ask for one re-review." },
  { t: "Escrow pays you.", d: "The reward leaves the bounty’s escrow contract for your wallet. The transaction is your receipt." },
];
/* What submission.ts and the X client actually check before a post is accepted. */
const CHECKS = ["Public x.com status link", "Written by your connected X account", "Not submitted before", "Bounty open when you submit"];

function Story({ data }: { data: HomeData }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const flood = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const flip = useRef<HTMLDivElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  const checks = useRef<HTMLDivElement>(null);
  const checkRows = useRef<(HTMLLIElement | null)[]>([]);
  const rubric = useRef<HTMLDivElement>(null);
  const signals = useRef<(HTMLLIElement | null)[]>([]);
  const score = useRef<HTMLSpanElement>(null);
  const stamp = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLSpanElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);

  // The post and the receipt it ends in belong to the same bounty.
  const first = data.payouts[0];
  const bounty = first?.campaign ?? data.bounties[0]?.title ?? "a bounty";
  const post = `Wrote up how a Soroban escrow actually releases funds, step by step, with the real transactions linked. For the “${bounty}” bounty.`;
  // The count-up target only: the figure shown at rest is the payout's own string. No payout, no receipt side at all.
  const reward = first ? Number(first.amount.replace(/,/g, "")) : 0;
  const split = first ? feeSplit(first.amount) : null;

  useTrack(track, (p) => {
    setStep(Math.min(4, Math.floor(p * 5)));
    if (rail.current) rail.current.style.transform = `scaleY(${p})`;

    const enter = ease(seg(p, 0, 0.1));
    if (card.current) card.current.style.transform = reduced ? "" : `translate3d(0, ${(1 - enter) * 70}vh, 0) rotate(${(1 - enter) * -9}deg)`;
    if (typed.current) typed.current.textContent = post.slice(0, Math.round(seg(p, 0.03, 0.17) * post.length));

    const ck = seg(p, 0.2, 0.25) * (1 - seg(p, 0.74, 0.79));
    if (checks.current) {
      checks.current.style.opacity = ck.toFixed(3);
      checks.current.style.transform = `translate3d(${(1 - ease(seg(p, 0.2, 0.25))) * 60}px, 0, 0)`;
    }
    checkRows.current.forEach((row, i) => row?.setAttribute("data-on", p > 0.24 + i * 0.045 ? "1" : "0"));

    const rb = seg(p, 0.4, 0.45) * (1 - seg(p, 0.74, 0.79));
    if (rubric.current) {
      rubric.current.style.opacity = rb.toFixed(3);
      rubric.current.style.transform = `translate3d(${(1 - ease(seg(p, 0.4, 0.45))) * -60}px, 0, 0)`;
    }
    let yes = 0;
    signals.current.forEach((row, i) => {
      const on = p > 0.44 + i * 0.022;
      if (on) yes += 1;
      row?.setAttribute("data-on", on ? "1" : "0");
    });
    if (score.current) score.current.textContent = String(yes);

    const s = seg(p, 0.62, 0.65);
    if (stamp.current) {
      stamp.current.style.opacity = s > 0 ? "1" : "0";
      stamp.current.style.transform = `rotate(-14deg) scale(${reduced ? 1 : 3.2 - 2.2 * ease(s)})`;
    }

    const f = ease(seg(p, 0.64, 0.76));
    const box = card.current?.getBoundingClientRect();
    if (flood.current && box) flood.current.style.clipPath = `circle(${f * 150}vmax at ${box.left + box.width / 2}px ${box.top + box.height / 2}px)`;
    sticky.current?.setAttribute("data-flood", f > 0.35 ? "1" : "0");

    const fl = first ? ease(seg(p, 0.8, 0.9)) : 0;
    if (flip.current) flip.current.style.transform = `rotateY(${fl * 180}deg)`;
    if (figure.current && first) {
      const a = seg(p, 0.84, 0.95);
      figure.current.textContent = a >= 1 ? first.amount : String(Math.round(a * reward));
    }
  });

  // Less motion asked for: the same five steps as a plain list, with the receipt they end in. No pinned scene.
  if (reduced) return <StillStory first={first} />;

  return (
    <section id="how" ref={track} aria-label="How it works" className="relative h-[560vh] scroll-mt-0 bg-canvas">
      {/* The scene below shows one step at a time; a screen reader gets all five, in order. */}
      <h2 className="sr-only">How it works: the life of one post</h2>
      <ol className="sr-only">
        {STEPS.map((s) => (
          <li key={s.t}>
            {s.t} {s.d}
          </li>
        ))}
      </ol>
      <div ref={sticky} data-flood="0" className="group sticky top-0 h-screen overflow-hidden text-white transition-colors duration-500 data-[flood=1]:text-black">
        <div ref={flood} className="absolute inset-0 [clip-path:circle(0)]" style={{ background: Y }} />

        <div className="relative mx-auto grid h-full max-w-6xl grid-rows-[auto_1fr] gap-4 px-6 pb-6 pt-24 md:grid-cols-[1fr_1.05fr] md:grid-rows-1 md:items-center md:gap-10 md:pb-8 md:pt-0">
          <div className="relative flex gap-6 md:gap-10">
            <div className="relative hidden w-px self-stretch bg-white/15 transition-colors group-data-[flood=1]:bg-black/20 md:block">
              <span ref={rail} className="absolute inset-0 origin-top bg-white transition-colors group-data-[flood=1]:bg-black" />
            </div>
            {/* On a phone the copy gets a fixed band above the card, sized for the longest step, so the card never sits on it. */}
            <div className="relative min-h-[16.5rem] flex-1 md:min-h-[22rem]">
              {STEPS.map((s, i) => (
                <div
                  key={s.t}
                  aria-hidden="true"
                  className={`absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${i === step ? "translate-y-0 opacity-100" : i < step ? "-translate-y-8 opacity-0" : "translate-y-8 opacity-0"}`}
                >
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/60 transition-colors group-data-[flood=1]:text-black/65">Step {i + 1} of 5</p>
                  <p className={`mt-2 text-[clamp(3.6rem,12vw,10rem)] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(60, 900) }}>
                    0{i + 1}
                  </p>
                  <h2 className={`mt-3 text-balance text-[clamp(1.8rem,4.2vw,3.6rem)] leading-[0.95] md:mt-4 ${FONT}`} style={{ fontVariationSettings: axes(88, 800) }}>
                    {s.t}
                  </h2>
                  <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-white/65 transition-colors group-data-[flood=1]:text-black/75 md:mt-4 md:text-[15px]">{s.d}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative flex items-start justify-center [perspective:1400px] md:items-center" aria-hidden="true">
            <div ref={card} className="relative h-[clamp(290px,calc(100svh-25rem),360px)] w-[min(340px,74vw)] will-change-transform md:h-[clamp(330px,46vh,420px)] md:w-[min(360px,78vw)]">
              <div ref={flip} className="relative size-full transition-transform duration-75 [transform-style:preserve-3d]">
                <div className="absolute inset-0 flex flex-col rounded-[28px] bg-white p-5 text-black shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] [backface-visibility:hidden] md:p-6 md:shadow-[0_50px_120px_-30px_rgba(0,0,0,0.7)]">
                  <div className="flex items-center gap-3">
                    <span className="size-10 rounded-full bg-[conic-gradient(from_200deg,#fdda24,#111,#f2f0e9,#fdda24)]" />
                    <div className="leading-tight">
                      <p className="text-sm font-bold">You</p>
                      <p className="text-xs text-black/45">@you · just now</p>
                    </div>
                    <span className="ml-auto text-xl font-black">X</span>
                  </div>
                  <p className="mt-4 text-[15px] leading-snug md:mt-5 md:min-h-[7.5rem] md:text-[clamp(16px,2.2vh,19px)]">
                    <span ref={typed} />
                    <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-blink bg-black" />
                  </p>
                  <div className="mt-auto rounded-2xl border border-black/10 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-black/45">Submitted to</p>
                    <p className="truncate text-sm font-semibold">{bounty}</p>
                  </div>
                  <div ref={stamp} className="pointer-events-none absolute right-5 top-[38%] opacity-0">
                    <div className="rounded-xl border-[5px] border-black px-4 py-1 text-black" style={{ background: Y }}>
                      <span className={`text-5xl ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                        PASS
                      </span>
                    </div>
                  </div>
                </div>
                {first ? (
                  <div className="absolute inset-0 flex flex-col rounded-[28px] bg-black p-5 text-white shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)] [backface-visibility:hidden] [transform:rotateY(180deg)] md:p-6 md:shadow-[0_50px_120px_-30px_rgba(0,0,0,0.6)]">
                    <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">
                      <span>Paid from escrow</span>
                      <span className="text-accent">● on chain</span>
                    </div>
                    <p className={`mt-5 text-[clamp(5rem,14vh,9rem)] leading-[0.8] text-accent md:mt-7 ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                      +<span ref={figure}>0</span>
                    </p>
                    <p className="mt-2 text-base font-semibold md:text-lg">USDC released from escrow</p>
                    {/* The receipt itself: what the escrow kept and what reached the wallet, then where it came from. */}
                    <dl className="mt-auto grid gap-1.5 text-[13px] md:gap-2 md:text-sm">
                      {split ? (
                        <>
                          <div className="flex justify-between gap-4">
                            <dt className="text-white/55">Protocol fee 0.3%</dt>
                            <dd className="font-mono">&minus;{split.fee}</dd>
                          </div>
                          <div className="flex justify-between gap-4 font-semibold">
                            <dt>To your wallet</dt>
                            <dd className="font-mono">{split.net} USDC</dd>
                          </div>
                        </>
                      ) : null}
                      <div className="mt-2 flex justify-between gap-4 border-t border-dashed border-white/25 pt-3 md:mt-3">
                        <dt className="text-white/55">Bounty</dt>
                        <dd className="truncate">{first.campaign}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-white/55">Transaction</dt>
                        <dd className="font-mono">
                          <a href={first.href} target="_blank" rel="noreferrer" tabIndex={-1} className="underline decoration-white/30 underline-offset-4 hover:decoration-white">
                            {first.hash}
                          </a>
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
              </div>

              <div ref={checks} className="absolute -right-3 top-3 w-56 rounded-2xl border border-white/10 bg-[#161616] p-3.5 text-white opacity-0 shadow-2xl md:-right-24 md:-top-6 md:w-64 md:p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">Automatic checks</p>
                <ul className="mt-3 space-y-2 text-[13px] md:space-y-2.5 md:text-sm">
                  {CHECKS.map((c, i) => (
                    <li
                      key={c}
                      ref={(el) => {
                        checkRows.current[i] = el;
                      }}
                      data-on="0"
                      className="group/row flex items-center gap-2.5 text-white/40 transition-colors duration-300 data-[on=1]:text-white"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/20 transition-all duration-300 group-data-[on=1]/row:scale-110 group-data-[on=1]/row:border-transparent group-data-[on=1]/row:bg-accent group-data-[on=1]/row:text-black">
                        <Check className="size-3 opacity-0 transition-opacity group-data-[on=1]/row:opacity-100" strokeWidth={3} />
                      </span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <div ref={rubric} className="absolute -bottom-6 -left-3 w-56 rounded-2xl bg-paper p-3.5 text-black opacity-0 shadow-2xl md:-bottom-8 md:-left-28 md:w-64 md:p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/50">Reviewer · {PASS_THRESHOLD} to pass</p>
                  <p className={`text-3xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
                    <span ref={score}>0</span>
                    <span className="text-black/35">/{SIGNALS.length}</span>
                  </p>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {SIGNALS.map((sig, i) => (
                    <li
                      key={sig.id}
                      ref={(el) => {
                        signals.current[i] = el;
                      }}
                      data-on="0"
                      className="group/sig flex items-center justify-between gap-2 text-xs text-black/40 transition-colors duration-300 data-[on=1]:text-black"
                    >
                      {sig.label}
                      <span className="rounded-full px-1.5 py-px font-mono text-[10px] font-semibold opacity-0 transition-all duration-300 group-data-[on=1]/sig:bg-black group-data-[on=1]/sig:text-accent group-data-[on=1]/sig:opacity-100">
                        YES
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs italic text-black/60">&ldquo;Real walkthrough, links check out.&rdquo;</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StillStory({ first }: { first: HomePayout | undefined }) {
  return (
    <section id="how" aria-labelledby="how-title" className="bg-canvas px-6 py-28 text-white">
      <div className="mx-auto grid max-w-6xl gap-14 md:grid-cols-[1fr_22rem] md:items-start">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/60">How it works</p>
          <h2 id="how-title" className={`mt-3 text-[clamp(2.6rem,6vw,5rem)] leading-[0.9] ${FONT}`} style={{ fontVariationSettings: axes(80, 850) }}>
            The life of one post.
          </h2>
          <ol className="mt-10 grid gap-8">
            {STEPS.map((s, i) => (
              <li key={s.t} className="grid grid-cols-[4.5rem_1fr] gap-5 border-t border-white/10 pt-6">
                <span className={`text-[3.5rem] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(60, 900) }}>
                  0{i + 1}
                </span>
                <div>
                  <h3 className={`text-[clamp(1.5rem,2.6vw,2rem)] leading-[0.95] ${FONT}`} style={{ fontVariationSettings: axes(88, 800) }}>
                    {s.t}
                  </h3>
                  <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/65">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        {first ? (
          <a href={first.href} target="_blank" rel="noreferrer" className="block rounded-[28px] bg-accent p-6 text-black">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/65">Released from escrow · {first.ago}</p>
            <p className={`mt-6 text-[6rem] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
              +{first.amount}
            </p>
            <p className="mt-2 font-semibold">USDC · {first.campaign}</p>
            <p className="mt-6 border-t border-black/20 pt-4 font-mono text-[12px]">
              tx {first.hash} <span aria-hidden="true">↗</span>
            </p>
          </a>
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────────── 3. the ledger: yellow, loud, real ───────────────────────────── */

/** One release as a black receipt on the moving belt. Decorative for the keyboard and screen readers: the list under the belt carries the same links, standing still. */
function Receipt({ p }: { p: HomePayout }) {
  return (
    <a href={p.href} target="_blank" rel="noreferrer" tabIndex={-1} className="group flex shrink-0 items-center gap-4 rounded-2xl bg-black px-5 py-4 text-white transition-transform hover:-translate-y-1">
      <span className={`text-4xl leading-none text-accent ${FONT}`} style={{ fontVariationSettings: axes(75, 900) }}>
        +{p.amount}
      </span>
      <span className="leading-tight">
        <span className="block max-w-[16rem] truncate text-sm font-semibold">{p.campaign}</span>
        <span className="block font-mono text-[11px] text-white/60">
          {p.hash} · {p.ago}
        </span>
      </span>
      <ArrowUpRight aria-hidden="true" className="size-4 text-white/50 transition-colors group-hover:text-white" />
    </a>
  );
}

function Ledger({ data, totals }: { data: HomeData; totals: NonNullable<HomeData["totals"]> }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const rows = data.payouts.length > 0 ? [data.payouts, [...data.payouts].reverse()] : [];
  return (
    <section id="ledger" aria-labelledby="ledger-title" className="relative overflow-hidden bg-accent pb-28 pt-16 text-black">
      <div ref={ref} className="mx-auto max-w-6xl px-6">
        <h2 id="ledger-title" className="sr-only">
          Paid so far
        </h2>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/65">Released from escrow so far · every one is a transaction</p>
        <p className={`mt-2 flex flex-wrap items-end gap-x-4 text-[clamp(7rem,27vw,24rem)] leading-[0.86] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
          <Odometer value={totals.paid} seen={seen} />
          <span className="mb-[0.12em] text-[0.18em] leading-none" style={{ fontVariationSettings: axes(100, 800) }}>
            USDC
          </span>
        </p>
        <dl className="mt-8 grid max-w-3xl grid-cols-3 gap-4 border-t-2 border-black pt-5">
          {(
            [
              [totals.payouts, "payouts released"],
              [totals.decisions, "decisions on chain"],
              [totals.campaigns, "bounties funded"],
            ] as const
          ).map(([n, l]) => (
            <div key={l} className="flex flex-col-reverse">
              <dt className="mt-1 text-sm text-black/70">{l}</dt>
              <dd className={`text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
                {n}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {rows.length > 0 ? (
        <>
          <div aria-hidden="true" className="mt-20 -rotate-[3deg] space-y-4 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            {rows.map((row, r) => (
              <div
                key={r}
                className="flex w-max animate-marquee gap-4 hover:[animation-play-state:paused]"
                style={{ animationDirection: r === 1 ? "reverse" : "normal", animationDuration: "55s" }}
              >
                {[0, 1].map((copy) => (
                  <div key={copy} className="flex gap-4">
                    {row.map((p, i) => (
                      <Receipt key={i} p={p} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* The same releases, standing still: one real link each, in reading and tab order. */}
          <div className="mx-auto mt-16 max-w-6xl px-6">
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-black/65">Latest releases</h3>
            <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-10 border-t-2 border-black md:grid-cols-2">
              {data.payouts.map((p, i) => (
                <li key={i} className="border-b border-black/15">
                  <a href={p.href} target="_blank" rel="noreferrer" className="group flex min-h-14 items-center gap-4 py-2.5">
                    <span className={`min-w-12 shrink-0 text-3xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(75, 900) }}>
                      +{p.amount}
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{p.campaign}</span>
                      <span className="mt-0.5 block font-mono text-[11.5px] text-black/70">
                        <span className="underline decoration-black/25 underline-offset-4 group-hover:decoration-black">{p.hash}</span> · {p.ago}
                      </span>
                    </span>
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                    <span className="sr-only">(opens the transaction)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="mx-auto mt-12 max-w-6xl px-6 text-lg">The first payout lands here with its transaction.</p>
      )}
    </section>
  );
}

/* ───────────────────────────── 4. open bounties: a horizontal run ───────────────────────────── */

function OpenRun({ data }: { data: HomeData }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const reduced = useReducedMotion();
  const list = [...data.bounties].sort((a, b) => Number(b.open) - Number(a.open));
  const pin = wide && !reduced && list.length > 2;
  const now = useClock();
  const track = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const open = list.filter((b) => b.open).length;

  // Tabbing to a card the pinned rail has not slid in yet: scroll the page to where the rail shows it.
  // A frame later, because the browser's own scroll-into-view runs after the focus event.
  function onFocus(e: React.FocusEvent<HTMLDivElement>) {
    const card = e.target instanceof HTMLElement ? e.target.closest("a") : null;
    if (!pin || !card) return;
    requestAnimationFrame(() => {
      const el = rail.current;
      const sec = track.current;
      if (!el || !sec || !el.contains(card)) return;
      const box = card.getBoundingClientRect();
      if (box.left >= 0 && box.right <= window.innerWidth) return;
      const dist = Math.max(0, el.scrollWidth - window.innerWidth);
      if (dist === 0) return;
      // Where the card sits on the untranslated rail, and the slide that centres it.
      const cardLeft = box.left - el.getBoundingClientRect().left;
      const want = clamp((cardLeft - (window.innerWidth - box.width) / 2) / dist);
      // Undo ease(): the rail moves by ease(p) of the distance.
      const p = 1 - Math.cbrt(1 - want);
      const top = sec.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + p * (sec.offsetHeight - window.innerHeight), behavior: "auto" });
    });
  }

  useTrack(track, (p) => {
    const el = rail.current;
    if (!el) return;
    if (!pin) {
      el.style.transform = "";
      return;
    }
    const dist = Math.max(0, el.scrollWidth - window.innerWidth);
    el.style.transform = `translate3d(${-ease(p) * dist}px, 0, 0)`;
    if (bar.current) bar.current.style.transform = `scaleX(${p})`;
  });

  return (
    <section id="open" ref={track} aria-labelledby="open-title" className="relative bg-canvas text-white" style={{ height: pin ? `${100 + list.length * 45}vh` : undefined }}>
      <div className={pin ? "sticky top-0 flex h-screen flex-col justify-center overflow-clip pt-16" : "py-24"}>
        <div className="mx-auto mb-8 flex w-full max-w-6xl flex-wrap items-end justify-between gap-6 px-6">
          <h2 id="open-title" className={`text-[clamp(3.2rem,8vw,7rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            {/* Only "open now" when every card here is open; ended ones sit at the end of the run. */}
            {open === list.length ? "Open now" : "Bounties"}
            <span className="text-accent">.</span>
          </h2>
          <div className="mb-2 flex max-w-[18rem] flex-col items-start gap-3 text-sm text-white/60 md:items-end md:text-right">
            <p>
              {open === list.length ? `${open} open.` : `${open} open, ${list.length - open} ended.`} On an open card, the slots are the posts its escrow
              can still pay for.
            </p>
            <Link href="/explore" className="inline-flex items-center gap-1.5 font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
              All bounties <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="mx-auto w-full max-w-6xl px-6 text-lg text-white/60">No bounty is live yet. The first one shows up here as soon as its budget is in escrow.</p>
        ) : (
          <div
            ref={rail}
            onFocus={onFocus}
            className={`flex gap-6 px-6 md:pl-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))] ${pin ? "will-change-transform md:pr-[20vw]" : "snap-x snap-mandatory overflow-x-auto pb-4"}`}
          >
            {list.map((b) => (
              <BountyCard key={b.slug} b={b} now={now} className="w-[min(420px,82vw)] shrink-0 snap-center md:min-h-[420px]" />
            ))}
          </div>
        )}
        {pin ? (
          <div className="mx-auto mt-8 h-px w-full max-w-6xl bg-white/10 px-6">
            <span ref={bar} className="block h-px origin-left" style={{ background: Y, transform: "scaleX(0)" }} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────────── 5. check it yourself: the rubric and a real hash ───────────────────────────── */

function CheckIt() {
  return (
    <section id="verify" aria-labelledby="verify-title" className="scroll-mt-0 overflow-hidden bg-paper pb-16 pt-24 text-black">
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">Don&rsquo;t trust us</p>
        <h2 id="verify-title" className={`mt-3 max-w-4xl text-[clamp(2.6rem,6vw,5.5rem)] leading-[0.9] ${FONT}`} style={{ fontVariationSettings: axes(82, 850) }}>
          Try the rubric. Then check the proof.
        </h2>
        <p className="mt-5 max-w-xl text-black/70">
          Both run the real thing: the same pass rule the reviewer uses, and a live <span className="whitespace-nowrap">SHA-256</span> over a decision that is actually on Stellar testnet.
        </p>
        <div className="mt-12 grid items-start gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[30px] bg-white p-6 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.5)] md:p-8">
            <h3 className={`text-2xl ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
              Six questions, {PASS_THRESHOLD} to pass
            </h3>
            <p className="mb-6 mt-2 max-w-md text-[15px] text-black/65">Flip any answer. A person makes this call for every post, and the outcome and the reason go on chain.</p>
            <RubricPlayground />
          </div>
          <div data-surface="dark" className="rounded-[30px] bg-[#111] p-6 text-white md:p-8">
            <h3 className={`text-2xl ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
              Don&rsquo;t trust us. Check.
            </h3>
            <p className="mb-6 mt-2 max-w-md text-[15px] text-white/60">
              A real decision record from the testnet run. Your browser hashes it; compare with the memo on the transaction.
            </p>
            <VerifyPlayground />
          </div>
        </div>
      </div>
      <div className="mt-16 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
        <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-label={copy === 0 ? "Transactions from the recorded testnet run" : undefined} aria-hidden={copy === 1 || undefined} className="flex gap-3">
              {EVIDENCE_TXS.map((tx) => (
                <li key={tx.label} className="flex items-center gap-2.5 whitespace-nowrap rounded-full bg-black px-4 py-2 font-mono text-[12px] text-white/65">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                  <b className="font-medium uppercase tracking-[0.08em] text-white">{tx.label}</b>
                  <span title={tx.hash}>{truncateMiddle(tx.hash, 10, 6)}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── 6. custody: who can move the money ───────────────────────────── */

function Custody() {
  return (
    <section id="custody" aria-labelledby="custody-title" className="bg-canvas px-6 py-28 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/60">Custody</p>
            <h2 id="custody-title" className={`mt-3 text-[clamp(2.8rem,7vw,6.5rem)] leading-[0.88] ${FONT}`} style={{ fontVariationSettings: axes(76, 900) }}>
              Who can move the money?
              <br />
              <span className="text-accent">Not Proofwork.</span>
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-white/65">
              Roles are fixed on the escrow contract when it is deployed. Proofwork&rsquo;s keys can add and approve milestones. They cannot send funds
              anywhere.
            </p>
            <Link href="/custody" className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-semibold underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Custody and fees <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
        <MoneyFlow className="mt-14" />
        <p className="mt-10 max-w-3xl text-[clamp(1.15rem,1.8vw,1.4rem)] leading-snug text-white/75">
          {SIGNALS.length} questions per post, {PASS_THRESHOLD} yeses to pass, one re-review per rejection while the bounty is open, and{" "}
          <span className="font-semibold text-white">no funds held by Proofwork</span>, ever.
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────────── 7. the close: letters that lean toward you ───────────────────────────── */

const CLOSE = ["DO THE", "WORK."];

function Close({ data }: { data: HomeData }) {
  const letters = useRef<(HTMLSpanElement | null)[]>([]);
  const raf = useRef(0);

  function onMove(e: React.PointerEvent<HTMLElement>) {
    if (e.pointerType !== "mouse" || !canHoverFine()) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      for (const el of letters.current) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
        const t = 1 - clamp(d / 420);
        el.style.fontVariationSettings = axes(60 + t * 90, 300 + t * 600);
        el.style.color = t > 0.72 ? Y : "";
      }
    });
  }
  function onLeave() {
    for (const el of letters.current) {
      if (!el) continue;
      el.style.fontVariationSettings = axes(60, 300);
      el.style.color = "";
    }
  }

  return (
    <section onPointerMove={onMove} onPointerLeave={onLeave} aria-labelledby="close-title" className="relative flex min-h-[90vh] flex-col justify-center overflow-hidden bg-canvas px-6 pb-24 pt-20 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <h2 id="close-title" aria-label="Do the work." className="sr-only">
          Do the work.
        </h2>
        <div aria-hidden="true">
          {CLOSE.map((line, li) => (
            <p key={line} className={`whitespace-nowrap text-[clamp(5rem,21vw,19rem)] leading-[0.84] ${FONT}`}>
              {[...line].map((ch, ci) => {
                const i = CLOSE.slice(0, li).join("").length + ci;
                return (
                  <span
                    key={i}
                    ref={(el) => {
                      letters.current[i] = el;
                    }}
                    className="inline-block transition-[font-variation-settings,color] duration-500 ease-out"
                    style={{ fontVariationSettings: axes(60, 300) }}
                  >
                    {ch === " " ? "\u00a0" : ch}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
        <p className="mt-10 max-w-md text-lg text-white/60">Run a campaign where every payout can be checked, or pick one and get paid for the work.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href={data.cta.href} className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-black transition-transform hover:scale-[1.03]" style={{ background: Y }}>
            {data.cta.label} <ArrowRight className="size-4" />
          </Link>
          <Link href="/campaigns" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-7 py-4 text-base font-semibold transition-colors hover:bg-white hover:text-black">
            Run a campaign for your team
          </Link>
          <a href="https://x.com/proofworkapp" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full py-4 text-base font-semibold text-white/70 transition-colors hover:text-white sm:px-5">
            Follow @proofworkapp <ArrowUpRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

/** The landing page: the life of one post, told in motion, over real data. */
export function Home({ data }: { data: HomeData }) {
  return (
    <div className="bg-canvas antialiased">
      <Hero data={data} />
      <Story data={data} />
      {data.totals ? <Ledger data={data} totals={data.totals} /> : null}
      <OpenRun data={data} />
      <CheckIt />
      <Custody />
      <Close data={data} />
    </div>
  );
}
