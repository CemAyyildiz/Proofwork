"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { useRef } from "react";
import type { Stage } from "@/components/contributor-state";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
import { axes, ease, FONT, Nav, PAPER, seg, useClock, useSeen, useTrack, Y } from "../stage";

export interface BountyData {
  slug: string;
  title: string;
  brief: string;
  team: string;
  stage: Stage;
  reward: string;
  budget: string;
  left: string;
  deadline: string;
  deadlineLabel: string;
  distance: string;
  submissions: number;
  paid: number;
  network: string;
  testnet: boolean;
  escrow: { short: string; href: string } | null;
  payouts: { shortId: string; amount: string; hash: string; href: string; ago: string; verify: string | null }[];
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];

const STATUS: Record<Stage, string> = { open: "Open", closed: "Closed", ended: "Ended", unfunded: "Not funded yet" };

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

/* ───────────────────────────── hero: the escrow drawn as slots ───────────────────────────── */

function SlotWall({ data }: { data: BountyData }) {
  const total = Math.max(1, Math.floor(Number(data.budget) / Math.max(0.0000001, Number(data.reward))));
  const shown = Math.min(total, 60);
  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(shown, 30)}, minmax(0, 1fr))` }}>
        {Array.from({ length: shown }, (_, i) => {
          const paid = i < data.paid;
          return (
            <span
              key={i}
              className={`h-10 animate-pop rounded-md md:h-14 ${paid ? "" : "border border-white/15"}`}
              style={{ animationDelay: `${500 + i * 22}ms`, background: paid ? Y : undefined }}
              title={paid ? "Paid" : "Still payable"}
            />
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">
        <span>
          <span className="text-[#fdda24]">{data.paid} paid</span> · {Math.max(0, total - data.paid)} still payable
          {total > shown ? ` (first ${shown} shown)` : ""}
        </span>
        <span>{data.left} of {data.budget} USDC left in escrow</span>
      </p>
    </div>
  );
}

function Hero({ data }: { data: BountyData }) {
  const words = data.title.split(/\s+/);
  const open = data.stage === "open";
  return (
    <section className="relative overflow-hidden bg-[#070707] px-6 pb-14 pt-28 text-white">
      <div className="mx-auto max-w-6xl">
        <Link href="/lab/e#open" className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white">
          <ArrowLeft className="size-3.5" /> All bounties
        </Link>
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/60">
          <span className={`rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider ${open ? "text-black" : "bg-white/10 text-white/70"}`} style={open ? { background: Y } : undefined}>
            {STATUS[data.stage]}
          </span>
          <span className="font-semibold text-white">{data.team}</span>
          <span>{data.submissions} posts in</span>
          <span>{open ? `closes ${data.distance}` : `deadline ${data.deadlineLabel}`}</span>
        </div>
        <h1 className={`mt-6 max-w-5xl text-[clamp(2.8rem,7.2vw,6.8rem)] leading-[0.9] ${FONT}`} style={{ fontVariationSettings: axes(84, 850) }}>
          {words.map((w, i) => (
            <span key={i} className="mr-[0.22em] inline-block overflow-y-clip pb-[0.06em] align-top">
              <span className="inline-block animate-rise" style={{ animationDelay: `${80 + i * 55}ms` }}>
                {w}
              </span>
            </span>
          ))}
        </h1>

        <div className="mt-12 grid items-end gap-10 md:grid-cols-[1fr_auto]">
          <div className="flex items-end gap-5">
            <p className={`text-[clamp(7rem,19vw,15rem)] leading-[0.78] text-[#fdda24] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
              {data.reward}
            </p>
            <div className="pb-3">
              <p className="text-xl font-semibold">USDC</p>
              <p className="text-sm text-white/55">for every approved post</p>
              <p className="mt-2 max-w-[14rem] text-xs text-white/40">
                Net of the 0.3% protocol fee.{data.testnet ? " Testnet USDC, not real money." : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pb-3">
            {open ? (
              <Link href={`/c/${data.slug}#submit`} className="group inline-flex items-center gap-2 rounded-full px-7 py-4 font-semibold text-black transition-transform hover:scale-[1.03]" style={{ background: Y }}>
                Submit your post <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            ) : null}
            {data.escrow ? (
              <a href={data.escrow.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-4 text-sm font-semibold transition-colors hover:bg-white hover:text-black">
                Escrow {data.escrow.short} <ArrowUpRight className="size-4" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-12">
          <SlotWall data={data} />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── body: the task, the rules, the ticket ───────────────────────────── */

function Signal({ i, s }: { i: number; s: (typeof SIGNALS)[number] }) {
  const [ref, seen] = useSeen<HTMLLIElement>();
  return (
    <li ref={ref} data-seen={seen ? "1" : "0"} className="group/sig border-b border-black/15">
      <details className="group/d">
        <summary className="flex cursor-pointer list-none items-center gap-5 py-5 [&::-webkit-details-marker]:hidden">
          <span className={`w-10 shrink-0 text-3xl leading-none text-black/25 ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="flex-1">
            <span className={`block text-[clamp(1.3rem,2.2vw,1.75rem)] leading-tight ${FONT}`} style={{ fontVariationSettings: axes(95, 750) }}>
              {s.label}
            </span>
            <span className="mt-1 block text-[15px] text-black/60">{s.question.charAt(0).toUpperCase() + s.question.slice(1)}</span>
          </span>
          <span
            className="hidden translate-y-2 rounded-full border border-black/20 px-2.5 py-1 font-mono text-[11px] text-black/55 opacity-0 sm:inline transition-all duration-500 group-data-[seen=1]/sig:translate-y-0 group-data-[seen=1]/sig:opacity-100"
            style={{ transitionDelay: `${200 + i * 60}ms` }}
          >
            yes / no
          </span>
          <Plus className="size-5 shrink-0 text-black/40 transition-transform duration-300 group-open/d:rotate-45" />
        </summary>
        <p className="-mt-1 mb-5 ml-15 max-w-xl rounded-xl bg-black/5 p-4 text-sm leading-relaxed text-black/70">
          <span className="font-semibold text-black">Counts as no: </span>
          {s.failsWhen}
        </p>
      </details>
    </li>
  );
}

function Ticket({ data }: { data: BountyData }) {
  const now = useClock();
  const parts = now === null ? null : left(data.deadline, now);
  const open = data.stage === "open";
  return (
    <aside className="rounded-[28px] bg-black p-7 text-white shadow-[0_40px_100px_-40px_rgba(0,0,0,0.6)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">{open ? "Closes in" : STATUS[data.stage]}</p>
      {open ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(parts ?? [["--", "days"], ["--", "hrs"], ["--", "min"], ["--", "sec"]]).map(([v, l]) => (
            <div key={l} className="rounded-xl bg-white/[0.06] py-3 text-center">
              <p className={`text-4xl leading-none tabular-nums ${FONT}`} style={{ fontVariationSettings: axes(70, 800) }}>
                {v}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-white/45">{l}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className={`mt-2 text-4xl ${FONT}`} style={{ fontVariationSettings: axes(80, 800) }}>
          {data.deadlineLabel}
        </p>
      )}

      <ol className="mt-7 space-y-4 border-t border-white/10 pt-6 text-sm">
        {[
          ["Connect a Stellar wallet", "The reward is paid to it in USDC."],
          ["Connect your X account", "Only posts from that account are accepted."],
          ["Paste the link to your post", "One post per person, reviewed within the window."],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/20 font-mono text-[11px]">{i + 1}</span>
            <span>
              <span className="block font-semibold">{t}</span>
              <span className="block text-white/50">{d}</span>
            </span>
          </li>
        ))}
      </ol>

      {open ? (
        <Link href={`/c/${data.slug}#submit`} className="group mt-7 flex items-center justify-between rounded-full px-6 py-4 font-semibold text-black transition-transform hover:scale-[1.02]" style={{ background: Y }}>
          Submit your post · {data.reward} USDC
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      ) : (
        <p className="mt-7 rounded-2xl bg-white/[0.06] p-4 text-sm text-white/60">
          {data.stage === "unfunded" ? "Submissions open once the budget is in escrow." : "This bounty no longer accepts posts."}
        </p>
      )}
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-white/45">Budget</dt>
          <dd className="mt-1 font-semibold">{data.budget} USDC</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-white/45">Left</dt>
          <dd className="mt-1 font-semibold text-[#fdda24]">{data.left} USDC</dd>
        </div>
      </dl>
    </aside>
  );
}

/* ───────────────────────────── payouts: yellow, one row per transaction ───────────────────────────── */

function Payouts({ data }: { data: BountyData }) {
  const track = useRef<HTMLElement>(null);
  const big = useRef<HTMLParagraphElement>(null);
  useTrack(track, (p) => {
    // The headline narrows from wide to condensed as the section passes, the same move as the home hero.
    if (big.current) big.current.style.fontVariationSettings = axes(125 - ease(seg(p, 0, 0.5)) * 65, 900);
  });
  return (
    <section ref={track} className="px-6 py-24 text-black" style={{ background: Y }}>
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">Paid from this bounty</p>
        <p ref={big} className={`mt-2 whitespace-nowrap text-[clamp(3rem,10vw,8.5rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(125, 900) }}>
          {data.payouts.length === 0 ? "Nobody yet." : `${data.payouts.length} ${data.payouts.length === 1 ? "payout" : "payouts"}.`}
        </p>
        {data.payouts.length === 0 ? (
          <p className="mt-6 max-w-md text-lg">The first approved post here gets paid first. It could be yours.</p>
        ) : (
          <ul className="mt-12 border-t-2 border-black">
            {data.payouts.map((p, i) => (
              <PayoutRow key={p.hash} p={p} i={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PayoutRow({ p, i }: { p: BountyData["payouts"][number]; i: number }) {
  const [ref, seen] = useSeen<HTMLLIElement>();
  return (
    <li
      ref={ref}
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-6 gap-y-1 border-b border-black/20 py-5 transition-all duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] md:grid-cols-[9rem_1fr_auto_auto] ${seen ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0"}`}
      style={{ transitionDelay: `${(i % 6) * 60}ms` }}
    >
      <span className={`text-5xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
        +{p.amount}
      </span>
      <span>
        <span className="block font-semibold">Submission {p.shortId}</span>
        <span className="block text-sm text-black/60">{p.ago}</span>
      </span>
      {p.verify ? (
        <Link href={p.verify} className="hidden rounded-full border border-black/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-black hover:text-[#fdda24] md:inline-flex">
          Decision
        </Link>
      ) : (
        <span className="hidden md:block" />
      )}
      <a href={p.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-black px-4 py-2 font-mono text-xs text-white transition-transform hover:-translate-y-0.5">
        {p.hash} <ArrowUpRight className="size-3.5" />
      </a>
    </li>
  );
}

export function Bounty({ data }: { data: BountyData }) {
  const open = data.stage === "open";
  return (
    <main className="bg-[#070707] antialiased">
      <Nav />
      <Hero data={data} />
      <section className="px-6 py-20 text-black" style={{ background: PAPER }}>
        <div className="mx-auto grid max-w-6xl items-start gap-14 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">The task</p>
            <p className="mt-5 max-w-2xl whitespace-pre-wrap text-[clamp(1.15rem,1.6vw,1.35rem)] leading-[1.6] [overflow-wrap:anywhere]">{data.brief}</p>

            <p className="mt-20 font-mono text-xs uppercase tracking-[0.2em] text-black/50">How you&rsquo;re reviewed</p>
            <h2 className={`mt-3 text-[clamp(2.2rem,4.5vw,3.8rem)] leading-[0.92] ${FONT}`} style={{ fontVariationSettings: axes(85, 850) }}>
              Six questions.
              <br />
              {WORDS[PASS_THRESHOLD] ?? PASS_THRESHOLD} yeses pass.
            </h2>
            <p className="mt-4 max-w-xl text-black/65">
              A person answers each one about your post. The answers and the reason go on chain, the funding team gives the final approval, and you can ask for one re-review.
            </p>
            <ol className="mt-8 border-t border-black/15">
              {SIGNALS.map((s, i) => (
                <Signal key={s.id} i={i} s={s} />
              ))}
            </ol>
          </div>
          <div className="lg:sticky lg:top-24">
            <Ticket data={data} />
          </div>
        </div>
      </section>
      <Payouts data={data} />
      <footer className="flex flex-wrap justify-between gap-4 bg-[#070707] px-6 py-8 font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
        <span>Proofwork · {data.network}</span>
        <span>Human-reviewed · escrow-paid · on chain</span>
      </footer>
      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/90 p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
          <Link href={`/c/${data.slug}#submit`} className="flex items-center justify-center gap-2 rounded-full py-3.5 font-semibold text-black" style={{ background: Y }}>
            Submit your post · {data.reward} USDC
          </Link>
        </div>
      ) : null}
    </main>
  );
}
