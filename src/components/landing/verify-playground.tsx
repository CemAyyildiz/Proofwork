"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { publicEnv } from "@/config/public-env";
import { truncateMiddle } from "@/lib/format";
import { sha256Hex } from "@/components/hash-check";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { useReducedMotion } from "@/components/use-reduced-motion";
import { SPIKE_RECORD } from "./evidence";
import { useInView } from "./reveal";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** JSON with keys, strings and literals coloured. Display only: the hashed bytes are `SPIKE_RECORD.canonicalJson`. */
function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null|-?\d+(?:\.\d+)?)\b/g;
  let last = 0;
  for (const m of json.matchAll(re)) {
    const at = m.index;
    if (at > last) out.push(json.slice(last, at));
    if (m[1] !== undefined && m[2] !== undefined) out.push(<span key={at} className="text-muted">{m[1]}</span>, m[2]);
    else if (m[1] !== undefined) out.push(<span key={at} className="text-text">{m[1]}</span>);
    else out.push(<span key={at} className="text-pass">{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

/**
 * Hashes the real spike001 decision record in the browser when the section
 * enters view, and compares it with the memo of the real testnet transaction.
 */
export function VerifyPlayground() {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>("0px 0px -30% 0px");
  const [hex, setHex] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0);

  async function run(mounted: () => boolean) {
    const token = ++runRef.current;
    const live = () => mounted() && runRef.current === token;
    setBusy(true);
    setHex(null);
    setShown(0);
    const h = await sha256Hex(SPIKE_RECORD.canonicalJson);
    if (!live()) return;
    setHex(h);
    if (reduce) setShown(h.length);
    else
      for (let i = 2; i <= h.length; i += 2) {
        await wait(14);
        if (!live()) return;
        setShown(i);
      }
    setBusy(false);
  }

  const start = useEffectEvent((mounted: () => boolean) => void run(mounted));

  useEffect(() => {
    if (!seen) return;
    let mounted = true;
    const t = setTimeout(() => start(() => mounted), 0);
    return () => {
      mounted = false;
      clearTimeout(t);
    };
  }, [seen]);

  const done = hex !== null && shown >= hex.length;
  const match = done && hex === SPIKE_RECORD.memoHash;

  return (
    <div ref={ref}>
      <pre className="relative mt-6 max-h-[170px] overflow-hidden whitespace-pre-wrap break-all rounded-lg border border-line bg-sunken p-[18px] font-mono text-xs leading-[1.7] text-text-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-14 after:bg-linear-180 after:from-transparent after:to-sunken">
        {highlight(SPIKE_RECORD.canonicalJson)}
      </pre>
      <div className="mt-4 grid gap-2.5">
        <HashRow label="Computed in your browser" state={done ? (match ? "match" : "mismatch") : "idle"}>
          {hex ? hex.slice(0, shown) : "—"}
        </HashRow>
        <HashRow
          label={
            <>
              Memo on Stellar <span className="normal-case tracking-normal">(tx {truncateMiddle(SPIKE_RECORD.txHash, 6, 6)})</span>
            </>
          }
          state="idle"
        >
          {SPIKE_RECORD.memoHash}
        </HashRow>
      </div>
      <div className="mt-[18px] flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button onClick={() => void run(() => true)} busy={busy} busyLabel="Hashing…">
          Recompute SHA-256
        </Button>
        <a
          href={publicEnv.explorerTxUrl(SPIKE_RECORD.txHash)}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm border-b border-line-strong pb-0.5 text-sm text-text-2 hover:text-text"
        >
          Open transaction ↗
        </a>
        <p aria-live="polite" className={cx("flex items-center gap-2 text-[15px] font-semibold", match ? "text-accent" : "text-fail")}>
          {done ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-pop stroke-current" aria-hidden="true">
                {match ? <path d="M5 12l5 5L20 7" /> : <path d="M6 6l12 12M18 6 6 18" />}
              </svg>
              {match ? "Hash matches the on-chain memo" : "Does not match the recorded hash"}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function HashRow({ label, state, children }: { label: ReactNode; state: "idle" | "match" | "mismatch"; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-[14px] border px-4 py-3.5 transition-colors duration-500",
        state === "match" ? "border-accent-line bg-accent-soft" : state === "mismatch" ? "border-fail-line bg-fail-soft" : "border-line bg-sunken",
      )}
    >
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <code
        className={cx(
          "mt-1.5 block min-h-5 break-all font-mono text-[13px]",
          state === "match" ? "text-accent" : state === "mismatch" ? "text-fail" : "text-text-2",
        )}
      >
        {children}
      </code>
    </div>
  );
}
