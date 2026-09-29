"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { publicEnv } from "@/config/public-env";
import { SIGNALS } from "@/domain/rubric";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { useMediaQuery, useReducedMotion } from "@/components/use-reduced-motion";
import { SPIKE_CONTRACT, SPIKE_FUND, SPIKE_LEDGER_VALUE, SPIKE_RECORD, SPIKE_RELEASE } from "./evidence";

const STEPS = [
  {
    title: "Fund the escrow",
    body: "The project locks its budget in a Trustless Work escrow on Stellar. Anyone can see it before doing any work.",
  },
  { title: "Contributors submit", body: "They do the task on X and submit the link from their Stellar wallet." },
  {
    title: "A person reviews",
    body: "Six yes/no signals, four to pass. The reviewer never knows which submissions are test fakes.",
  },
  { title: "Recorded and paid", body: "The decision is written to Stellar with its reason. The funder signs, USDC moves." },
] as const;

const LAST = STEPS.length - 1;

/**
 * Pinned four-stage pipeline (≥ lg). Scroll position picks the stage; the
 * sticky panel is plain `position: sticky`. Below lg, and under reduced
 * motion, every stage is shown at once with the final, on-chain scene.
 */
export function Pipeline({ heading }: { heading: ReactNode }) {
  const reduce = useReducedMotion();
  const wide = useMediaQuery("(min-width: 1024px)");
  const pinned = wide && !reduce;
  const [index, setIndex] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    function update() {
      frame = 0;
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      setIndex(Math.min(LAST, Math.floor(p * STEPS.length)));
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pinned]);

  const active = pinned ? index : LAST;

  return (
    <section ref={sectionRef} id="how" aria-label="How it works" className={cx("relative", pinned && "h-[400vh]")}>
      <div
        className={cx(
          "grid items-center gap-7 py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-[6vw]",
          pinned && "sticky top-16 h-[calc(100vh-64px)] py-0",
        )}
      >
        <div>
          {heading}
          <ol className="mt-8 border-t border-line lg:mt-11">
            {STEPS.map((s, i) => {
              const on = !pinned || i === index;
              return (
                <li
                  key={s.title}
                  aria-current={pinned && i === index ? "step" : undefined}
                  className={cx(
                    "grid grid-cols-[54px_1fr] border-b border-line py-5 transition-opacity duration-500",
                    on ? "opacity-100" : "opacity-35",
                  )}
                >
                  <span className="pt-1 font-mono text-[13px] font-medium text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="text-[22px] font-semibold tracking-[-0.03em]">{s.title}</p>
                    <p
                      className={cx(
                        "max-w-[420px] overflow-hidden text-[15px] leading-normal text-muted transition-[max-height,margin] duration-500",
                        on ? "mt-1.5 max-h-24" : "mt-0 max-h-0",
                      )}
                    >
                      {s.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {pinned ? (
            <div aria-hidden="true" className="relative mt-7 h-0.5 overflow-hidden bg-line">
              <span ref={barRef} className="absolute inset-0 origin-left scale-x-0 bg-accent" />
            </div>
          ) : null}
        </div>

        <div className="relative h-[460px] overflow-hidden rounded-xxl border border-line-strong bg-[radial-gradient(120%_90%_at_80%_0%,var(--color-accent-soft)_0%,var(--color-surface)_45%,var(--color-sunken)_100%)] lg:h-[560px]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(var(--color-line)_1px,transparent_1.2px)] bg-size-[22px_22px] mask-[linear-gradient(180deg,black,transparent)]"
          />
          {SCENES.map((scene, i) => (
            <div
              key={i}
              aria-hidden={i !== active}
              inert={i !== active}
              className={cx(
                "absolute inset-0 grid place-items-center p-5 transition-[opacity,transform] duration-700 ease-expo",
                i === active ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-8 scale-[0.97] opacity-0",
              )}
            >
              {scene}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SCENES: ReactNode[] = [
  <div key="vault" className="text-center">
    <div className="mx-auto grid h-[88px] w-[88px] place-items-center rounded-[26px] bg-accent">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" className="stroke-accent-ink" aria-hidden="true">
        <rect x="4" y="10" width="16" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    </div>
    <p className="mt-7 text-[88px] font-semibold leading-none tracking-[-0.06em] lg:text-[120px]">
      {SPIKE_FUND.amount}
      <small className="ml-2.5 text-[28px] font-medium tracking-[-0.02em] text-muted">USDC</small>
    </p>
    <p className="mt-4 font-mono text-[13px] text-muted">Funded in the testnet run · Trustless Work escrow</p>
    <div className="mt-3 flex justify-center">
      <HashChip value={SPIKE_CONTRACT} href={publicEnv.explorerAccountUrl(SPIKE_CONTRACT)} />
    </div>
  </div>,

  <div key="post" className="w-full max-w-[420px] rounded-[20px] border border-line-strong bg-sunken p-[22px]">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-linear-135 from-line-strong to-raised text-[13px] font-semibold text-text-2">
          @
        </span>
        <span className="text-[13px] text-muted">A contributor&apos;s post</span>
        <span className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-accent">
          Example
        </span>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" className="fill-text" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </div>
    <p className="mt-3.5 text-[17px] leading-normal">
      Set up a testnet wallet and went through a full campaign. Seeing the escrow balance up front is the part that made me trust it.
    </p>
    <p className="mt-4 border-t border-line pt-3.5 font-mono text-xs text-muted">Submitted as an x.com status link, never fetched.</p>
  </div>,

  <div key="review" className="w-full max-w-[440px]">
    {SIGNALS.map((s) => (
      <div key={s.id} className="mt-1.5 flex items-center justify-between rounded-[14px] border border-line bg-white/3 px-4 py-2.5 text-[15px]">
        {s.label}
        <span className="rounded-full bg-pass-soft px-2.5 py-1 font-mono text-xs font-medium tracking-[0.06em] text-pass">PASS</span>
      </div>
    ))}
    <div className="mt-3.5 flex items-center justify-between rounded-lg border border-line-strong bg-sunken p-[18px]">
      <p className="text-[40px] font-semibold tracking-[-0.05em]">
        6<small className="text-lg text-muted"> / 6</small>
      </p>
      <span className="rounded-full bg-pass px-3.5 py-2 font-mono text-sm font-medium tracking-widest text-accent-ink">PASS</span>
    </div>
  </div>,

  <div key="ledger" className="w-full max-w-[480px] font-mono">
    <dl className="rounded-[20px] border border-line-strong bg-sunken p-[22px] text-[13.5px]">
      {[
        ["ledger key", <span key="k">{SPIKE_RECORD.ledgerKey}</span>],
        ["value", <span key="v" className="break-all">{SPIKE_LEDGER_VALUE}</span>],
        ["memo", <HashChip key="m" value={SPIKE_RECORD.memoHash} />],
        ["tx", <HashChip key="t" value={SPIKE_RECORD.txHash} href={publicEnv.explorerTxUrl(SPIKE_RECORD.txHash)} />],
      ].map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[92px_1fr] items-center border-b border-dashed border-line py-2.5 last:border-0">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 text-text-2">{v}</dd>
        </div>
      ))}
    </dl>
    <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-pass-line bg-linear-90 from-pass-soft to-transparent px-[22px] py-[18px] font-sans">
      <p>
        <b className="text-[30px] font-semibold tracking-[-0.04em] text-pass">+{SPIKE_RELEASE.amount} USDC</b>{" "}
        <span className="text-sm text-text-2">released to the contributor</span>
      </p>
      <HashChip value={SPIKE_RELEASE.txHash} href={publicEnv.explorerTxUrl(SPIKE_RELEASE.txHash)} />
    </div>
  </div>,
];
