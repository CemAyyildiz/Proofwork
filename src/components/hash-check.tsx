"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { publicEnv } from "@/config/public-env";
import { truncateMiddle } from "@/lib/format";
import { Button, buttonClasses } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { useReducedMotion } from "@/components/use-reduced-motion";

/** 0 idle · 1 reading the record · 2 hashing · 3 comparing · 4 done */
type Step = 0 | 1 | 2 | 3 | 4;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the seal says once the check is done; null while it is still running. */
export function sealFor(computed: string | null, expected: string, txHash: string | null): { tone: "pass" | "fail"; title: string } | null {
  if (computed === null) return null;
  if (computed !== expected) return { tone: "fail", title: "Does not match the recorded hash" };
  return { tone: "pass", title: txHash ? "Hash matches the on-chain memo" : "Matches the recorded hash" };
}

/**
 * Recomputes SHA-256 of the canonical JSON in the browser with WebCrypto and
 * compares it with the recorded hash, as a three-step proof with a seal.
 */
export function HashCheck({ canonicalJson, expectedHash, txHash }: { canonicalJson: string; expectedHash: string; txHash: string | null }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>(0);
  const [computed, setComputed] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const runRef = useRef(0);
  const recordId = useId();

  /** Each run gets a token; a newer run or an unmount makes the older one stop. */
  async function run(mounted: () => boolean, instant: boolean) {
    const token = ++runRef.current;
    const live = () => mounted() && runRef.current === token;
    await wait(instant ? 0 : 400);
    if (!live()) return;
    setStep(1);
    await wait(instant ? 0 : 500);
    if (!live()) return;
    setStep(2);
    const hex = await sha256Hex(canonicalJson);
    if (!live()) return;
    setComputed(hex);
    if (instant) setShown(hex.length);
    else
      for (let i = 2; i <= hex.length; i += 2) {
        if (!live()) return;
        setShown(i);
        await wait(16);
      }
    setStep(3);
    await wait(instant ? 0 : 500);
    if (!live()) return;
    setStep(4);
  }

  const start = useEffectEvent((mounted: () => boolean) => {
    void run(mounted, reduce);
  });

  // Runs on load, and again if the record or the motion setting changes.
  useEffect(() => {
    let mounted = true;
    const t = setTimeout(() => start(() => mounted), 0);
    return () => {
      mounted = false;
      clearTimeout(t);
    };
  }, [canonicalJson, reduce]);

  function again() {
    setStep(0);
    setComputed(null);
    setShown(0);
    void run(() => true, reduce);
  }

  const done = step === 4;
  const seal = sealFor(computed, expectedHash, txHash);
  const match = seal?.tone === "pass";
  const bytes = new TextEncoder().encode(canonicalJson).length;
  const state = (n: 1 | 2 | 3): "idle" | "run" | "ok" | "fail" =>
    step > n || (n === 3 && done) ? (n === 3 && !match ? "fail" : "ok") : step === n ? "run" : "idle";

  return (
    <div>
      <ol className="mt-5 grid gap-2.5">
        <ProofStep n={1} state={state(1)} title="Take the canonical record">
          <p className="mt-1 text-[13px] text-muted">The exact bytes that were hashed: {bytes} bytes.</p>
          <pre
            id={recordId}
            className={cx(
              "mt-2.5 overflow-hidden whitespace-pre-wrap break-all rounded-md border border-line bg-sunken p-3.5 font-mono text-xs leading-[1.65] text-text-2",
              !expanded && "max-h-[calc(4*1.65*12px+28px)]",
            )}
          >
            {canonicalJson}
          </pre>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={recordId}
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 rounded-sm text-[12.5px] text-muted underline decoration-line-strong underline-offset-[3px] hover:text-text"
          >
            {expanded ? "Collapse record" : "Show full record"}
          </button>
        </ProofStep>
        <ProofStep n={2} state={state(2)} title="Hash it with SHA-256">
          <p className="mt-1 text-[13px] text-muted">WebCrypto, on your device. Nothing is sent anywhere.</p>
          <code className={cx("mt-2.5 block min-h-5 break-all font-mono text-[12.5px] leading-[1.6]", done ? (match ? "text-accent" : "text-fail") : "text-text-2")}>
            {computed ? computed.slice(0, shown) : step >= 2 ? "computing…" : "—"}
          </code>
        </ProofStep>
        <ProofStep n={3} state={state(3)} title="Compare with the memo on Stellar">
          <p className="mt-1 text-[13px] text-muted">
            {txHash ? `memo_hash of tx ${truncateMiddle(txHash, 6, 6)}` : "The recorded hash. This decision has no transaction yet."}
          </p>
          <code className="mt-2.5 block break-all font-mono text-[12.5px] leading-[1.6] text-accent">{expectedHash}</code>
        </ProofStep>
      </ol>

      <div aria-live="polite">
        {done && seal ? (
          <Seal tone={seal.tone} title={seal.title}>
            {seal.tone === "pass"
              ? `This record is exactly what was committed${txHash ? " on-chain" : ""}.`
              : "The hash your browser computed differs from the recorded one. Compare both values above."}
          </Seal>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button size="sm" onClick={again} busy={step > 0 && !done} busyLabel="Checking…">
          Run again
        </Button>
        {txHash ? (
          <a href={publicEnv.explorerTxUrl(txHash)} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "sm")}>
            Open transaction ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ProofStep({ n, state, title, children }: { n: number; state: "idle" | "run" | "ok" | "fail"; title: string; children: ReactNode }) {
  return (
    <li
      className={cx(
        "grid grid-cols-[36px_minmax(0,1fr)] gap-3.5 rounded-lg border bg-sunken p-4 transition-colors duration-300",
        state === "ok" ? "border-accent-line" : state === "fail" ? "border-fail-line" : "border-line",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "grid h-9 w-9 place-items-center rounded-[11px] border font-mono text-[13px] font-medium transition-colors duration-300",
          state === "ok" && "border-accent bg-accent text-accent-ink",
          state === "fail" && "border-fail bg-fail text-accent-ink",
          state === "run" && "border-accent text-accent",
          state === "idle" && "border-line-strong text-muted",
        )}
      >
        {n}
      </span>
      <div className="min-w-0">
        <p className="mt-0.5 text-[15px] font-semibold">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Seal({ tone, title, children }: { tone: "pass" | "fail"; title: string; children: ReactNode }) {
  const ok = tone === "pass";
  return (
    <div
      className={cx(
        "mt-4 flex animate-reveal items-center gap-4 rounded-[18px] border px-5 py-[18px]",
        ok ? "border-accent-line bg-linear-90 from-accent-soft to-transparent" : "border-fail-line bg-linear-90 from-fail-soft to-transparent",
      )}
    >
      <span aria-hidden="true" className={cx("grid h-12 w-12 shrink-0 animate-pop place-items-center rounded-[15px]", ok ? "bg-accent" : "bg-fail")}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-ink">
          {ok ? <path d="M5 12l5 5L20 7" /> : <path d="M6 6l12 12M18 6 6 18" />}
        </svg>
      </span>
      <div>
        <p className={cx("text-[19px] font-semibold tracking-[-0.02em]", ok ? "text-accent" : "text-fail")}>{title}</p>
        <p className="mt-0.5 text-[13.5px] text-text-2">{children}</p>
      </div>
    </div>
  );
}
