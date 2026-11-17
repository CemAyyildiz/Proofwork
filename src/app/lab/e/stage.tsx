"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { canHoverFine, useMediaQuery, useReducedMotion } from "@/components/use-reduced-motion";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";

export interface StageData {
  network: string;
  totals: { paid: string; payouts: number; decisions: number; campaigns: number };
  payouts: { amount: string; campaign: string; slug: string; hash: string; href: string; ago: string }[];
  bounties: {
    slug: string;
    title: string;
    team: string;
    reward: string;
    budget: string;
    paid: number;
    submissions: number;
    paidPct: number;
    open: boolean;
    deadline: string;
    distance: string;
  }[];
}

export const Y = "#fdda24";
export const PAPER = "#f2f0e9";
export const FONT = "[font-family:var(--font-anybody)]";

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** Progress of `p` through the window [a, b], clamped to 0..1. */
export const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
export const ease = (t: number) => 1 - (1 - t) ** 3;
export const axes = (wdth: number, wght: number) => `"wdth" ${wdth.toFixed(1)}, "wght" ${wght.toFixed(0)}`;

/**
 * Calls `frame` with how far the page has scrolled through `ref` (0 when its top
 * meets the top of the viewport, 1 when its bottom meets the bottom). The work is
 * batched into one animation frame per scroll, and nothing re-renders.
 */
export function useTrack(ref: RefObject<HTMLElement | null>, frame: (p: number) => void) {
  const cb = useRef(frame);
  useLayoutEffect(() => {
    cb.current = frame;
  });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      cb.current(total > 0 ? clamp(-r.top / total) : 0);
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    queue();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
    };
  }, [ref]);
}

/** True once the element is on screen; never flips back. */
export function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -15% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

let clockNow = 0;
function subscribeClock(onChange: () => void) {
  clockNow = Date.now();
  queueMicrotask(onChange);
  const id = setInterval(() => {
    clockNow = Date.now();
    onChange();
  }, 1000);
  return () => clearInterval(id);
}
/** Wall clock that ticks every second, null until the page is hydrated so server and client agree. */
export function useClock(): number | null {
  return useSyncExternalStore(subscribeClock, () => clockNow || null, () => null);
}

/* ───────────────────────────── nav ───────────────────────────── */

export function Nav() {
  return (
    <nav className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="flex w-full max-w-3xl items-center justify-between gap-4 rounded-full border border-white/10 bg-[#0b0b0b]/90 py-2 pl-5 pr-2 text-white backdrop-blur-xl">
        <Link href="/lab/e" className={`text-lg lowercase ${FONT}`} style={{ fontVariationSettings: axes(125, 800) }}>
          proofwork
        </Link>
        <div className="hidden items-center gap-6 text-sm text-white/60 sm:flex">
          <Link href="/lab/e#how" className="transition-colors hover:text-white">How it works</Link>
          <Link href="/lab/e#ledger" className="transition-colors hover:text-white">Payouts</Link>
          <Link href="/lab/e#open" className="transition-colors hover:text-white">Bounties</Link>
        </div>
        <Link href="/lab/e#open" className="rounded-full px-4 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.03]" style={{ background: Y }}>
          Find a bounty
        </Link>
      </div>
    </nav>
  );
}

/* ───────────────────────────── 1. hero: a stream of real receipts flying at you ───────────────────────────── */

const LINES = ["POST IT.", "PROVE IT.", "GET PAID."];
const SPAN = 3600;

function Hero({ data }: { data: StageData }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLDivElement | null)[]>([]);
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
        const z = (((f.z + t * 140 + p * 2600) % SPAN) + SPAN) % SPAN - 3000;
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
    <section ref={track} className="relative h-[230vh] bg-[#070707] text-white">
      <div className="sticky top-0 h-screen overflow-hidden">
        <div ref={stage} className="absolute inset-0 [perspective:900px] [transform-style:preserve-3d]">
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

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 text-center">
          <div ref={fade} className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">
            <span className="size-1.5 animate-ping rounded-full text-[#fdda24]" style={{ background: Y }} />
            Bounties on {data.network}
          </div>
          {LINES.map((l, i) => (
            <div key={l} className="w-full overflow-x-visible overflow-y-clip py-[0.02em]">
              <div
                ref={(el) => {
                  lines.current[i] = el;
                }}
                className={`animate-rise whitespace-nowrap text-[clamp(3.4rem,13vw,12.5rem)] leading-[0.86] will-change-transform ${FONT}`}
                style={{ animationDelay: `${120 + i * 110}ms`, fontVariationSettings: axes(112, 900), color: i === 2 ? Y : undefined }}
              >
                {l}
              </div>
            </div>
          ))}
          <div className="mt-10 flex flex-col items-center gap-6 opacity-0 animate-reveal [animation-delay:700ms]">
            <p className="max-w-md text-balance text-[15px] leading-relaxed text-white/60">
              Teams post bounties. You post the work on X. A person reviews it, and the escrow pays you on Stellar. Every payout below is a real transaction.
            </p>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
          <span className="animate-pulse">Scroll</span>
        </div>
      </div>
    </section>
  );
}

function FlyCard({ kind, payout }: { kind: number; payout: StageData["payouts"][number] | undefined }) {
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
        <p className="mt-1 text-xs font-semibold">USDC · {payout?.campaign ?? "Bounty"}</p>
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
        <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-white/80">Posted for “{payout?.campaign ?? "a bounty"}”.</p>
      </div>
    );
  return (
    <div className="rounded-2xl p-4 text-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]" style={{ background: PAPER }}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-black px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#fdda24]">PASS</span>
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

function Story({ data }: { data: StageData }) {
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
  const reward = Number(first?.amount ?? "10");

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
    <section id="how" ref={track} className="relative h-[560vh] bg-[#070707]">
      <div ref={sticky} data-flood="0" className="group sticky top-0 h-screen overflow-hidden text-white transition-colors duration-500 data-[flood=1]:text-black">
        <div ref={flood} className="absolute inset-0 [clip-path:circle(0)]" style={{ background: Y }} />

        <div className="relative mx-auto grid h-full max-w-6xl grid-rows-[auto_1fr] gap-6 px-6 pb-8 pt-24 md:grid-cols-[1fr_1.05fr] md:grid-rows-1 md:items-center md:gap-10 md:pt-0">
          {/* words */}
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

          {/* the card */}
          <div className="relative flex items-center justify-center [perspective:1400px]">
            <div ref={card} className="relative h-[clamp(330px,52vh,460px)] w-[min(360px,78vw)] will-change-transform">
              <div ref={flip} className="relative size-full transition-transform duration-75 [transform-style:preserve-3d]">
                {/* front: the post */}
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
                {/* back: the receipt */}
                <div className="absolute inset-0 flex flex-col rounded-[28px] bg-black p-6 text-white shadow-[0_50px_120px_-30px_rgba(0,0,0,0.6)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">
                    <span>Paid from escrow</span>
                    <span className="text-[#fdda24]">● on chain</span>
                  </div>
                  <p className={`mt-auto text-[clamp(6rem,14vh,9rem)] leading-[0.8] text-[#fdda24] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
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
                          <a href={first.href} target="_blank" rel="noreferrer" className="underline decoration-white/30 underline-offset-4 hover:decoration-white">
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

              {/* panels that dock onto the card */}
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
                      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/20 transition-all duration-300 group-data-[on=1]/row:scale-110 group-data-[on=1]/row:border-transparent group-data-[on=1]/row:bg-[#fdda24] group-data-[on=1]/row:text-black">
                        <Check className="size-3 opacity-0 transition-opacity group-data-[on=1]/row:opacity-100" strokeWidth={3} />
                      </span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <div ref={rubric} className="absolute -bottom-8 -left-4 w-64 rounded-2xl bg-[#f2f0e9] p-4 text-black opacity-0 shadow-2xl md:-left-28">
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
                      <span className="rounded-full px-1.5 py-px font-mono text-[10px] font-semibold opacity-0 transition-all duration-300 group-data-[on=1]/sig:bg-black group-data-[on=1]/sig:text-[#fdda24] group-data-[on=1]/sig:opacity-100">
                        YES
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs italic text-black/60">“Real walkthrough, links check out.”</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── 3. the ledger: yellow, loud, real ───────────────────────────── */

function Odometer({ value, seen }: { value: string; seen: boolean }) {
  return (
    <span className="inline-flex" aria-label={value}>
      {[...value].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} aria-hidden className="inline-block h-[0.86em] overflow-hidden">
            <span
              className="flex flex-col transition-transform duration-[1800ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: `translateY(${seen ? -Number(ch) * 10 : 0}%)`, transitionDelay: `${i * 90}ms` }}
            >
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d} className="h-[0.86em] leading-[0.86]">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

function Receipt({ p }: { p: StageData["payouts"][number] }) {
  return (
    <a
      href={p.href}
      target="_blank"
      rel="noreferrer"
      className="group flex shrink-0 items-center gap-4 rounded-2xl bg-black px-5 py-4 text-white transition-transform hover:-translate-y-1"
    >
      <span className={`text-4xl leading-none text-[#fdda24] ${FONT}`} style={{ fontVariationSettings: axes(75, 900) }}>
        +{p.amount}
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">{p.campaign}</span>
        <span className="block font-mono text-[11px] text-white/50">
          {p.hash} · {p.ago}
        </span>
      </span>
      <ArrowUpRight className="size-4 text-white/40 transition-colors group-hover:text-white" />
    </a>
  );
}

function Ledger({ data }: { data: StageData }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const rows = data.payouts.length > 0 ? [data.payouts, [...data.payouts].reverse()] : [];
  return (
    <section id="ledger" className="relative overflow-hidden pb-28 pt-16 text-black" style={{ background: Y }}>
      <div ref={ref} className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">Paid so far · every one is a transaction</p>
        <p className={`mt-2 flex items-end gap-4 text-[clamp(7rem,27vw,24rem)] leading-[0.86] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
          <Odometer value={data.totals.paid} seen={seen} />
          <span className="mb-[0.12em] text-[0.18em] leading-none" style={{ fontVariationSettings: axes(100, 800) }}>
            USDC
          </span>
        </p>
        <div className="mt-8 grid max-w-3xl grid-cols-3 gap-4 border-t-2 border-black pt-5">
          {[
            [data.totals.payouts, "payouts released"],
            [data.totals.decisions, "decisions on chain"],
            [data.totals.campaigns, "bounties funded"],
          ].map(([n, l]) => (
            <div key={String(l)}>
              <p className={`text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
                {n}
              </p>
              <p className="mt-1 text-sm text-black/65">{l}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-20 -rotate-[3deg] space-y-4 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
        {rows.map((row, r) => (
          <div key={r} className="flex w-max gap-4 hover:[animation-play-state:paused] lab-marquee" style={{ animationDirection: r === 1 ? "reverse" : "normal", animationDuration: "55s" }}>
            {[...row, ...row].map((p, i) => (
              <Receipt key={i} p={p} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── 4. open bounties: a horizontal run ───────────────────────────── */

export function countdown(deadline: string, now: number): string {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms / 3_600_000) % 24);
  const m = Math.floor((ms / 60_000) % 60);
  const s = Math.floor((ms / 1000) % 60);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function Tilt({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={className}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== "mouse" || !canHoverFine()) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.transition = "transform 0.15s ease-out";
        el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 10}deg) rotateY(${(x - 0.5) * 12}deg) translateZ(0)`;
        el.style.setProperty("--gx", `${x * 100}%`);
        el.style.setProperty("--gy", `${y * 100}%`);
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (!el) return;
        el.style.transition = "transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)";
        el.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}

function BountyCard({ b, now }: { b: StageData["bounties"][number]; now: number | null }) {
  const slots = Math.max(0, Math.floor(Number(b.budget) / Math.max(1, Number(b.reward))));
  return (
    <Tilt className="group/card relative h-[min(560px,68vh)] w-[min(420px,82vw)] shrink-0 snap-center will-change-transform">
      <Link
        href={`/lab/e/${b.slug}`}
        className={`relative flex size-full flex-col overflow-hidden rounded-[30px] p-7 ${b.open ? "text-black" : "bg-[#151515] text-white/70"}`}
        style={b.open ? { background: PAPER } : undefined}
      >
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 [background:radial-gradient(circle_at_var(--gx,50%)_var(--gy,50%),rgba(255,255,255,0.7),transparent_45%)] group-hover/card:opacity-100" />
        <div className="relative flex items-center justify-between text-sm">
          <span className="font-semibold">{b.team}</span>
          <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${b.open ? "bg-black text-[#fdda24]" : "bg-white/10"}`}>
            {b.open ? (now ? countdown(b.deadline, now) : b.distance) : `Ended ${b.distance}`}
          </span>
        </div>
        <h3 className={`relative mt-6 line-clamp-3 text-[clamp(1.9rem,3vw,2.6rem)] leading-[0.95] ${FONT}`} style={{ fontVariationSettings: axes(85, 800) }}>
          {b.title}
        </h3>
        <div className="relative mt-auto">
          <p className={`text-[7.5rem] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
            {b.reward}
          </p>
          <p className="mt-2 text-sm font-semibold">USDC for every approved post</p>
          <div className="mt-5 flex gap-[3px]">
            {Array.from({ length: Math.min(slots, 30) }, (_, i) => (
              <span key={i} className={`h-6 flex-1 rounded-[3px] ${i < b.paid ? (b.open ? "bg-black" : "bg-white/50") : b.open ? "bg-black/12" : "bg-white/10"}`} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs opacity-65">
            <span>
              {b.paid} of {slots} paid
            </span>
            <span>{b.submissions} posts in</span>
          </div>
          {b.open && (
            <span className="mt-5 flex items-center justify-between rounded-full bg-black px-5 py-3.5 text-sm font-semibold text-white transition-colors group-hover/card:bg-[#fdda24] group-hover/card:text-black">
              Do this bounty <ArrowRight className="size-4 transition-transform group-hover/card:translate-x-1" />
            </span>
          )}
        </div>
      </Link>
    </Tilt>
  );
}

function OpenRun({ data }: { data: StageData }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const reduced = useReducedMotion();
  const pin = wide && !reduced;
  const now = useClock();
  const track = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const list = [...data.bounties].sort((a, b) => Number(b.open) - Number(a.open));
  const open = list.filter((b) => b.open).length;

  useTrack(track, (p) => {
    const el = rail.current;
    if (!el) return;
    if (!pin) {
      el.style.transform = "";
      return;
    }
    const dist = el.scrollWidth - window.innerWidth;
    el.style.transform = `translate3d(${-ease(p) * dist}px, 0, 0)`;
    if (bar.current) bar.current.style.transform = `scaleX(${p})`;
  });

  return (
    <section id="open" ref={track} className="relative bg-[#070707] text-white" style={{ height: pin ? `${100 + list.length * 45}vh` : undefined }}>
      <div className={pin ? "sticky top-0 flex h-screen flex-col justify-center overflow-hidden pt-16" : "py-24"}>
        <div className="mx-auto mb-8 flex w-full max-w-6xl items-end justify-between gap-6 px-6">
          <h2 className={`text-[clamp(3.2rem,8vw,7rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            Open now<span className="text-[#fdda24]">.</span>
          </h2>
          <p className="mb-2 max-w-[16rem] text-right text-sm text-white/55">
            {open} open, {list.length - open} ended. Each card is a funded escrow; the slots are the posts it can still pay for.
          </p>
        </div>
        <div ref={rail} className={`flex gap-6 px-6 md:pl-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))] md:pr-[20vw] ${pin ? "will-change-transform" : "snap-x snap-mandatory overflow-x-auto pb-4"}`}>
          {list.map((b) => (
            <BountyCard key={b.slug} b={b} now={now} />
          ))}
        </div>
        {pin && (
          <div className="mx-auto mt-8 h-px w-full max-w-6xl bg-white/10 px-6">
            <span ref={bar} className="block h-px origin-left" style={{ background: Y, transform: "scaleX(0)" }} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────── 5. the close: letters that lean toward you ───────────────────────────── */

const CLOSE = ["DO THE", "WORK."];

function Close({ data }: { data: StageData }) {
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
    <section onPointerMove={onMove} onPointerLeave={onLeave} className="relative flex min-h-screen flex-col justify-between overflow-hidden bg-[#070707] px-6 pb-8 pt-28 text-white">
      <div className="mx-auto w-full max-w-6xl">
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
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <a href="#open" className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-black transition-transform hover:scale-[1.03]" style={{ background: Y }}>
            Find a bounty <ArrowRight className="size-4" />
          </a>
          <Link href="/campaigns/new" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-7 py-4 text-base font-semibold transition-colors hover:bg-white hover:text-black">
            Fund one for your team
          </Link>
        </div>
      </div>
      <div className="mx-auto mt-24 flex w-full max-w-6xl flex-wrap justify-between gap-4 border-t border-white/10 pt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
        <span>Proofwork · {data.network}</span>
        <span>Human-reviewed · escrow-paid · on chain</span>
      </div>
    </section>
  );
}

export function Stage({ data }: { data: StageData }) {
  return (
    <main className="bg-[#070707] antialiased">
      <Nav />
      <Hero data={data} />
      <Story data={data} />
      <Ledger data={data} />
      <OpenRun data={data} />
      <Close data={data} />
    </main>
  );
}
