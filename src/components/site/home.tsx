"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { axes, clamp, ease, FONT, PAPER, seg, useClock, useSeen, useTrack, Y } from "@/components/e/motion";
import { BountyCard, type BountyCardData } from "./bounty-card";
import { Odometer } from "./odometer";
import { EVIDENCE_TXS } from "@/components/landing/evidence";
import { RubricPlayground } from "@/components/landing/rubric-playground";
import { VerifyPlayground } from "@/components/landing/verify-playground";
import { LogoMark } from "@/components/ui/logo";
import { canHoverFine, useMediaQuery, useReducedMotion } from "@/components/use-reduced-motion";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
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

  const n = 18;
  const fly = Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996;
    const r = 26 + ((i * 37) % 19);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62, z: (i / n) * SPAN, ry: Math.cos(a) * -18, payout: data.payouts[i % Math.max(1, data.payouts.length)], kind: i % 3 };
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
        const z = ((((f.z + t * 140 + p * 2600) % SPAN) + SPAN) % SPAN) - 3000;
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
    const onScroll = () => {
      if (reduced && !raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
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
              <FlyCard kind={f.kind} payout={f.payout} />
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(7,7,7,0.55)_45%,#070707_80%)]" />

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 pt-10 text-center">
          <div ref={fade} className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">
            <span className="size-1.5 animate-ping rounded-full text-accent" style={{ background: Y }} />
            Bounties on {data.network}
          </div>
          <h1 className="w-full">
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
          <div className="mt-10 flex animate-reveal flex-col items-center gap-6 [animation-delay:700ms]">
            <p className="max-w-md text-balance text-[15px] leading-relaxed text-white/60">
              Teams post bounties. You post the work on X. A person reviews it, and the escrow pays you on Stellar. Every payout below is a real
              transaction.
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
        <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
          <span className="flex animate-pulse items-center gap-2">
            Scroll <ArrowDown className="size-3" />
          </span>
        </div>
      </div>
    </section>
  );
}

function FlyCard({ kind, payout }: { kind: number; payout: HomePayout | undefined }) {
  const amount = payout?.amount ?? "10";
  if (kind === 0)
    return (
      <div className="rounded-2xl p-4 text-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" style={{ background: Y }}>
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-black/60">
          <span>Released</span>
          <span>{payout?.ago ?? "now"}</span>
        </div>
        <p className={`mt-2 text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
          +{amount}
        </p>
        <p className="mt-1 truncate text-xs font-semibold">USDC · {payout?.campaign ?? "Bounty"}</p>
        <p className="mt-3 font-mono text-[10px] text-black/60">tx {payout?.hash ?? "…"}</p>
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
        <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-white/80">Posted for &ldquo;{payout?.campaign ?? "a bounty"}&rdquo;.</p>
      </div>
    );
  return (
    <div className="rounded-2xl p-4 text-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" style={{ background: PAPER }}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-black px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-accent">PASS</span>
        <span className={`text-2xl ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
          6/6
        </span>
      </div>
      <p className="mt-3 text-xs text-black/60">Reviewed by a person, recorded on chain.</p>
    </div>
  );
}

/* ───────────────────────────── 2. the life of one post ───────────────────────────── */

const STEPS = [
  { t: "Post it on X.", d: "Pick a bounty, do the work, and post about it from your own account. Paste the link into the bounty." },
  { t: "Machines check the boring part.", d: "A real x.com status, from the account linked to your wallet, posted while the bounty was open." },
  { t: "A person reads it.", d: `A reviewer answers six yes/no questions about the post. ${PASS_THRESHOLD} yeses pass it, and the funding team gives the final approval.` },
  { t: "The decision goes on chain.", d: "The answers and the reason are recorded on Stellar before a single cent moves. Disagree? You can ask for one re-review." },
  { t: "Escrow pays you.", d: "The reward leaves the bounty’s escrow contract for your wallet. The transaction is your receipt." },
];
const CHECKS = ["Real x.com status link", "Account linked to your wallet", "Posted inside the window"];

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
  const amount = useRef<HTMLSpanElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);

  const first = data.payouts[0];
  const bounty = data.bounties[0]?.title ?? first?.campaign ?? "Stellar Builders";
  const post = `Wrote up how a Soroban escrow actually releases funds, step by step, with the real transactions linked. For the “${bounty}” bounty.`;
  const reward = Number((first?.amount ?? "10").replace(/,/g, ""));

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

    const fl = ease(seg(p, 0.8, 0.9));
    if (flip.current) flip.current.style.transform = `rotateY(${fl * 180}deg)`;
    if (amount.current) {
      const a = seg(p, 0.84, 0.95);
      amount.current.textContent = a >= 1 ? (first?.amount ?? "10") : String(Math.round(a * reward));
    }
  });

  return (
    <section id="how" ref={track} aria-label="How it works" className="relative h-[560vh] scroll-mt-0 bg-canvas">
      <div ref={sticky} data-flood="0" className="group sticky top-0 h-screen overflow-hidden text-white transition-colors duration-500 data-[flood=1]:text-black">
        <div ref={flood} className="absolute inset-0 [clip-path:circle(0)]" style={{ background: Y }} />

        <div className="relative mx-auto grid h-full max-w-6xl grid-rows-[auto_1fr] gap-6 px-6 pb-8 pt-28 md:grid-cols-[1fr_1.05fr] md:grid-rows-1 md:items-center md:gap-10 md:pt-0">
          <div className="relative flex gap-6 md:gap-10">
            <div className="relative hidden w-px self-stretch bg-white/15 transition-colors group-data-[flood=1]:bg-black/20 md:block">
              <span ref={rail} className="absolute inset-0 origin-top bg-white transition-colors group-data-[flood=1]:bg-black" />
            </div>
            <div className="relative min-h-[15rem] flex-1 md:min-h-[22rem]">
              {STEPS.map((s, i) => (
                <div
                  key={s.t}
                  aria-hidden={i !== step}
                  className={`absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${i === step ? "translate-y-0 opacity-100" : i < step ? "-translate-y-8 opacity-0" : "translate-y-8 opacity-0"}`}
                >
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50 transition-colors group-data-[flood=1]:text-black/55">Step {i + 1} of 5</p>
                  <p className={`mt-2 text-[clamp(5rem,12vw,10rem)] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(60, 900) }}>
                    0{i + 1}
                  </p>
                  <h2 className={`mt-4 text-balance text-[clamp(2rem,4.2vw,3.6rem)] leading-[0.95] ${FONT}`} style={{ fontVariationSettings: axes(88, 800) }}>
                    {s.t}
                  </h2>
                  <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/60 transition-colors group-data-[flood=1]:text-black/70">{s.d}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative flex items-center justify-center [perspective:1400px]" aria-hidden="true">
            <div ref={card} className="relative h-[clamp(330px,52vh,460px)] w-[min(360px,78vw)] will-change-transform">
              <div ref={flip} className="relative size-full transition-transform duration-75 [transform-style:preserve-3d]">
                <div className="absolute inset-0 flex flex-col rounded-[28px] bg-white p-6 text-black shadow-[0_50px_120px_-30px_rgba(0,0,0,0.7)] [backface-visibility:hidden]">
                  <div className="flex items-center gap-3">
                    <span className="size-10 rounded-full bg-[conic-gradient(from_200deg,#fdda24,#111,#f2f0e9,#fdda24)]" />
                    <div className="leading-tight">
                      <p className="text-sm font-bold">You</p>
                      <p className="text-xs text-black/45">@you · just now</p>
                    </div>
                    <span className="ml-auto text-xl font-black">X</span>
                  </div>
                  <p className="mt-5 min-h-[7.5rem] text-[clamp(16px,2.2vh,19px)] leading-snug">
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
                <div className="absolute inset-0 flex flex-col rounded-[28px] bg-black p-6 text-white shadow-[0_50px_120px_-30px_rgba(0,0,0,0.6)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">
                    <span>Paid from escrow</span>
                    <span className="text-accent">● on chain</span>
                  </div>
                  <p className={`mt-auto text-[clamp(6rem,14vh,9rem)] leading-[0.8] text-accent ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                    +<span ref={amount}>0</span>
                  </p>
                  <p className="mt-2 text-lg font-semibold">USDC to your wallet</p>
                  <dl className="mt-6 space-y-2 border-t border-white/15 pt-4 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-white/50">Bounty</dt>
                      <dd className="truncate">{first?.campaign ?? bounty}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-white/50">Transaction</dt>
                      <dd className="font-mono">
                        {first ? (
                          <a href={first.href} target="_blank" rel="noreferrer" tabIndex={-1} className="underline decoration-white/30 underline-offset-4 hover:decoration-white">
                            {first.hash}
                          </a>
                        ) : (
                          "…"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div ref={checks} className="absolute -right-4 -top-6 w-64 rounded-2xl border border-white/10 bg-[#161616] p-4 text-white opacity-0 shadow-2xl md:-right-24">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">Automatic checks</p>
                <ul className="mt-3 space-y-2.5 text-sm">
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
              <div ref={rubric} className="absolute -bottom-8 -left-4 w-64 rounded-2xl bg-paper p-4 text-black opacity-0 shadow-2xl md:-left-28">
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

/* ───────────────────────────── 3. the ledger: yellow, loud, real ───────────────────────────── */

function Receipt({ p }: { p: HomePayout }) {
  return (
    <a href={p.href} target="_blank" rel="noreferrer" className="group flex shrink-0 items-center gap-4 rounded-2xl bg-black px-5 py-4 text-white transition-transform hover:-translate-y-1">
      <span className={`text-4xl leading-none text-accent ${FONT}`} style={{ fontVariationSettings: axes(75, 900) }}>
        +{p.amount}
      </span>
      <span className="leading-tight">
        <span className="block max-w-[16rem] truncate text-sm font-semibold">{p.campaign}</span>
        <span className="block font-mono text-[11px] text-white/50">
          {p.hash} · {p.ago}
        </span>
      </span>
      <ArrowUpRight className="size-4 text-white/40 transition-colors group-hover:text-white" />
    </a>
  );
}

function Ledger({ data, totals }: { data: HomeData; totals: NonNullable<HomeData["totals"]> }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const rows = data.payouts.length > 0 ? [data.payouts, [...data.payouts].reverse()] : [];
  return (
    <section id="ledger" aria-label="Paid so far" className="relative overflow-hidden pb-28 pt-16 text-black" style={{ background: Y }}>
      <div ref={ref} className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">Paid so far · every one is a transaction</p>
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
              <dt className="mt-1 text-sm text-black/65">{l}</dt>
              <dd className={`text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
                {n}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {rows.length > 0 ? (
        <div className="mt-20 -rotate-[3deg] space-y-4 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          {rows.map((row, r) => (
            <div
              key={r}
              aria-hidden={r === 1 || undefined}
              className="flex w-max animate-marquee gap-4 hover:[animation-play-state:paused]"
              style={{ animationDirection: r === 1 ? "reverse" : "normal", animationDuration: "55s" }}
            >
              {[...row, ...row].map((p, i) => (
                <Receipt key={i} p={p} />
              ))}
            </div>
          ))}
        </div>
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
      <div className={pin ? "sticky top-0 flex h-screen flex-col justify-center overflow-hidden pt-16" : "py-24"}>
        <div className="mx-auto mb-8 flex w-full max-w-6xl flex-wrap items-end justify-between gap-6 px-6">
          <h2 id="open-title" className={`text-[clamp(3.2rem,8vw,7rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            Open now<span className="text-accent">.</span>
          </h2>
          <div className="mb-2 flex max-w-[18rem] flex-col items-start gap-3 text-sm text-white/55 md:items-end md:text-right">
            <p>
              {open} open, {list.length - open} ended. Each card is a funded escrow; the slots are the posts it can still pay for.
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
            className={`flex gap-6 px-6 md:pl-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))] ${pin ? "will-change-transform md:pr-[20vw]" : "snap-x snap-mandatory overflow-x-auto pb-4"}`}
          >
            {list.map((b) => (
              <BountyCard key={b.slug} b={b} now={now} className="h-[min(560px,68vh)] min-h-[440px] w-[min(420px,82vw)] shrink-0 snap-center" />
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
    <section id="verify" aria-labelledby="verify-title" className="scroll-mt-0 overflow-hidden pb-16 pt-24 text-black" style={{ background: PAPER }}>
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Don&rsquo;t trust us</p>
        <h2 id="verify-title" className={`mt-3 max-w-4xl text-[clamp(2.6rem,6vw,5.5rem)] leading-[0.9] ${FONT}`} style={{ fontVariationSettings: axes(82, 850) }}>
          Try the rubric. Then check the proof.
        </h2>
        <p className="mt-5 max-w-xl text-black/65">
          Both run the real thing: the same pass rule the reviewer uses, and a live SHA-256 over a decision that is actually on Stellar testnet.
        </p>
        <div className="mt-12 grid items-start gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[30px] bg-white p-6 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.5)] md:p-8">
            <h3 className={`text-2xl ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
              Six questions, {PASS_THRESHOLD} to pass
            </h3>
            <p className="mb-6 mt-2 max-w-md text-[15px] text-black/60">Flip any answer. A person makes this call for every post, and the outcome and the reason go on chain.</p>
            <RubricPlayground />
          </div>
          <div className="rounded-[30px] bg-[#111] p-6 text-white md:p-8">
            <h3 className={`text-2xl ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
              Don&rsquo;t trust us. <span className="text-accent">Check.</span>
            </h3>
            <p className="mb-6 mt-2 max-w-md text-[15px] text-white/55">
              A real decision record from the testnet run. Your browser hashes it; compare with the memo on the transaction.
            </p>
            <VerifyPlayground />
          </div>
        </div>
      </div>
      <div aria-label="Transactions from the recorded testnet run" className="mt-16 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
        <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 || undefined} className="flex gap-3">
              {EVIDENCE_TXS.map((tx) => (
                <li key={tx.label} className="flex items-center gap-2.5 whitespace-nowrap rounded-full bg-black px-4 py-2 font-mono text-[12px] text-white/60">
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

const ROLES: ReadonlyArray<{ name: string; can: string[]; cannot: string[]; mark: "funder" | "proofwork" | "resolver" }> = [
  { name: "Funder", mark: "funder", can: ["Funds the escrow", "Signs every release, the final approval", "Gets the remainder back at the deadline"], cannot: [] },
  { name: "Proofwork keys", mark: "proofwork", can: ["Add a milestone per approved submission", "Write decision records to Stellar"], cannot: ["Cannot release or move funds"] },
  { name: "Neutral resolver", mark: "resolver", can: ["Returns what's left to the funder"], cannot: ["Cannot pay anyone else"] },
];

const FACTS: ReadonlyArray<{ value: number; label: string; accent?: boolean }> = [
  { value: SIGNALS.length, label: "signals scored per submission" },
  { value: PASS_THRESHOLD, label: "needed to pass" },
  { value: 1, label: "re-review per rejection, while the campaign is open" },
  { value: 0, label: "funds held by Proofwork", accent: true },
];

function RoleCard({ r, i }: { r: (typeof ROLES)[number]; i: number }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const funder = r.mark === "funder";
  return (
    <div
      ref={ref}
      className={`flex min-h-[300px] flex-col rounded-[28px] p-7 transition-all duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${funder ? "text-black" : "border border-white/10 bg-[#111] text-white"} ${seen ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`}
      style={{ background: funder ? Y : undefined, transitionDelay: `${i * 90}ms` }}
    >
      <span className={`grid size-12 place-items-center rounded-2xl ${funder ? "bg-black text-accent" : "bg-white/[0.06]"}`}>
        {r.mark === "proofwork" ? <LogoMark className="size-[22px]" /> : r.mark === "funder" ? <span className={`text-xl ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>$</span> : <span className={`text-xl ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>⚖</span>}
      </span>
      <h3 className={`mt-6 text-[1.7rem] leading-none ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
        {r.name}
      </h3>
      <ul className="mt-5 grid gap-2.5">
        {r.can.map((t) => (
          <li key={t} className={`flex items-start gap-2.5 text-[15px] leading-snug ${funder ? "text-black/80" : "text-white/75"}`}>
            <Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} />
            {t}
          </li>
        ))}
        {r.cannot.map((t) => (
          <li key={t} className="flex items-start gap-2.5 text-[15px] leading-snug text-fail">
            <X className="mt-0.5 size-4 shrink-0" strokeWidth={3} />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Custody() {
  const [ref, seen] = useSeen<HTMLDListElement>();
  return (
    <section id="custody" aria-labelledby="custody-title" className="bg-canvas px-6 py-28 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">Custody</p>
            <h2 id="custody-title" className={`mt-3 text-[clamp(2.8rem,7vw,6.5rem)] leading-[0.88] ${FONT}`} style={{ fontVariationSettings: axes(76, 900) }}>
              Who can move the money?
              <br />
              <span className="text-accent">Not Proofwork.</span>
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-white/60">
              Roles are fixed on the escrow contract when it is deployed. Proofwork&rsquo;s keys can add and approve milestones. They cannot send funds
              anywhere.
            </p>
            <Link href="/custody" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Custody and fees <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {ROLES.map((r, i) => (
            <RoleCard key={r.name} r={r} i={i} />
          ))}
        </div>
        <dl ref={ref} className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col-reverse justify-end rounded-[28px] border border-white/10 p-6">
              <dt className="mt-3 text-sm text-white/55">{f.label}</dt>
              <dd className={`text-[clamp(4rem,8vw,6rem)] leading-[0.8] ${FONT} ${f.accent ? "text-accent" : ""}`} style={{ fontVariationSettings: axes(62, 900) }}>
                <Odometer value={String(f.value)} seen={seen} />
              </dd>
            </div>
          ))}
        </dl>
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
          <a href="https://x.com/proofworkapp" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full px-5 py-4 text-base font-semibold text-white/70 transition-colors hover:text-white">
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
