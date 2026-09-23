"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { SIGNALS } from "@/domain/rubric";
import { truncateMiddle } from "@/lib/format";
import { cx } from "@/components/ui/cx";
import { canHoverFine, useReducedMotion } from "@/components/use-reduced-motion";
import { SPIKE_LEDGER_VALUE, SPIKE_RECORD } from "./evidence";

/** 0 Submitted · 1 Reviewing · 2 Recording · 3 Paid */
type Phase = 0 | 1 | 2 | 3;

const PHASE_LABEL = ["SUBMITTED", "REVIEWING", "RECORDING", "PAID"] as const;

/** The on-chain lines use the real spike001 record; the post itself is illustrative. */
const CHAIN_LINES: ReadonlyArray<readonly [string, string]> = [
  ["key ", SPIKE_RECORD.ledgerKey],
  ["val ", SPIKE_LEDGER_VALUE],
  ["memo", truncateMiddle(SPIKE_RECORD.memoHash, 20, 8)],
];
const CHAIN_LENGTH = CHAIN_LINES.reduce((n, [k, v]) => n + k.length + 1 + v.length, 0);

interface View {
  phase: Phase;
  lit: number;
  typed: number;
}

const FINAL: View = { phase: 3, lit: SIGNALS.length, typed: CHAIN_LENGTH };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Hero object: a submission card that loops Submitted → Reviewing → Recording
 * → Paid. It renders its final state on the server and under reduced motion.
 */
export function ProofCard() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<View>(FINAL);
  const cardRef = useRef<HTMLDivElement>(null);
  const view = reduce ? FINAL : state;

  const loop = useEffectEvent(async (alive: () => boolean) => {
    while (alive()) {
      await wait(2600);
      if (!alive()) return;
      setState({ phase: 0, lit: 0, typed: 0 });
      await wait(1300);
      if (!alive()) return;
      setState((s) => ({ ...s, phase: 1 }));
      for (let i = 1; i <= SIGNALS.length; i++) {
        await wait(260);
        if (!alive()) return;
        setState((s) => ({ ...s, lit: i }));
      }
      await wait(400);
      if (!alive()) return;
      setState((s) => ({ ...s, phase: 2 }));
      for (let t = 0; t <= CHAIN_LENGTH; t += 2) {
        await wait(22);
        if (!alive()) return;
        setState((s) => ({ ...s, typed: t }));
      }
      await wait(300);
      if (!alive()) return;
      setState(FINAL);
    }
  });

  useEffect(() => {
    if (reduce) return;
    let alive = true;
    const t = setTimeout(() => void loop(() => alive), 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [reduce]);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card || e.pointerType !== "mouse" || !canHoverFine()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transition = "transform 0.8s cubic-bezier(0.2, 0.7, 0.1, 1)";
    card.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 12}deg)`;
  }

  function onLeave() {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = "transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)";
    card.style.transform = "";
  }

  const paid = view.phase === 3;
  let budget = view.typed;

  return (
    <div className="relative perspective-[1400px]" onPointerMove={onMove} onPointerLeave={onLeave}>
      <div
        ref={cardRef}
        role="img"
        aria-label="Illustration: a submission moves from submitted, through review and an on-chain record, to paid."
        className="card-glow relative mx-auto w-full max-w-[460px] animate-reveal rounded-[24px] border border-line-strong bg-linear-160 from-raised from-0% to-surface to-60% p-5 shadow-[0_60px_120px_-40px_black] transform-3d sm:p-[26px]"
        style={{ animationDelay: "300ms" }}
      >
        <div aria-hidden="true">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[13px] font-medium text-muted">
              submission <b className="font-medium text-text">{SPIKE_RECORD.submission}</b>
            </span>
            <span
              className={cx(
                "inline-flex h-[26px] items-center gap-[7px] rounded-full border px-[11px] font-mono text-xs font-medium tracking-[0.04em] transition-colors duration-500",
                paid ? "border-pass-line bg-pass-soft text-pass" : "border-accent-line bg-accent-soft text-accent",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {PHASE_LABEL[view.phase]}
            </span>
          </div>

          <div className="mt-[18px] rounded-lg border border-line bg-sunken p-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-linear-135 from-line-strong to-raised text-[13px] font-semibold text-text-2">
                @
              </span>
              <span className="text-[13px] text-muted">A contributor&apos;s post on X</span>
            </div>
            <p className="mt-2.5 text-sm leading-[1.55] text-text-2">
              Tried the testnet flow. Seeing the escrow balance before doing anything is what made me trust it. The brief could use an
              example post.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-1.5">
            {SIGNALS.map((s, i) => {
              const on = i < view.lit;
              return (
                <div
                  key={s.id}
                  className={cx(
                    "flex items-center gap-2 rounded-[10px] border px-2.5 py-[9px] text-[12.5px] transition-colors duration-300 sm:text-[13px]",
                    on ? "border-pass-line bg-pass-soft text-text" : "border-line bg-white/2 text-muted",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors duration-300",
                      on ? "border-pass bg-pass" : "border-faint",
                    )}
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={cx("stroke-accent-ink transition-[opacity,transform] duration-300", on ? "scale-100 opacity-100" : "scale-40 opacity-0")}
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </span>
                  <span className="truncate">{s.label}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-3.5 min-h-[92px] rounded-[14px] border border-dashed border-line-strong px-4 py-3.5 font-mono text-[12px] leading-[1.7] text-muted sm:text-[12.5px]">
            {view.phase < 2 ? (
              <>
                awaiting decision <span className="inline-block h-3.5 w-[7px] animate-blink bg-accent align-[-2px]" />
              </>
            ) : (
              CHAIN_LINES.map(([k, v]) => {
                const take = Math.max(0, Math.min(k.length + 1 + v.length, budget));
                budget -= take;
                const text = `${k} ${v}`.slice(0, take);
                if (take === 0) return null;
                return (
                  <span key={k} className="block truncate">
                    <span className="text-faint">{text.slice(0, k.length + 1)}</span>
                    <span className={k === "memo" ? "text-accent" : "text-text-2"}>{text.slice(k.length + 1)}</span>
                  </span>
                );
              })
            )}
          </div>

          <div
            className={cx(
              "mt-3.5 flex items-center justify-between rounded-[14px] border border-pass-line bg-linear-90 from-pass-soft to-transparent px-4 py-3.5 transition-opacity duration-500",
              paid ? "opacity-100" : "opacity-25",
            )}
          >
            <span className="text-lg font-semibold tracking-[-0.03em] text-pass">Paid</span>
            <span className="font-mono text-xs text-muted">USDC released from escrow</span>
          </div>

          <div className="mt-[18px] flex gap-1.5">
            {PHASE_LABEL.map((p, i) => (
              <span key={p} className="relative h-[3px] flex-1 overflow-hidden rounded-[2px] bg-line-strong">
                <span
                  className={cx(
                    "absolute inset-0 origin-left bg-accent transition-transform duration-700",
                    i <= view.phase ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
