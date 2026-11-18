"use client";

import { useEffect, useState } from "react";
import { truncateMiddle } from "@/lib/format";
import { cx } from "./cx";

export interface HashChipProps {
  /** The full identifier: tx hash, contract ID, wallet address or ledger key. */
  value: string;
  /** Leading characters kept. 6 for hashes and contracts, 4 for wallets. */
  head?: number;
  tail?: number;
  /** stellar.expert link. When set the value opens it in a new tab with a ↗. */
  href?: string;
  className?: string;
}

type CopyState = "idle" | "copied" | "failed";

const COPIED_MS = 1500;

export function HashChip({ value, head = 6, tail = 6, href, className }: HashChipProps) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const t = setTimeout(() => setCopy("idle"), COPIED_MS);
    return () => clearTimeout(t);
  }, [copy]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopy("copied");
    } catch {
      // Clipboard access denied or unavailable: say so inline instead of pretending.
      setCopy("failed");
    }
  }

  const short = truncateMiddle(value, head, tail);
  const text = (
    <>
      <span aria-hidden="true">{short}</span>
      {href ? (
        <span aria-hidden="true" className="opacity-60">
          ↗
        </span>
      ) : null}
    </>
  );

  return (
    // A near-black chip on any surface: `data-surface="dark"` gives its link and copy button the yellow focus ring even on paper or yellow.
    <span
      data-surface="dark"
      className={cx(
        "group inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-[#0b0b0b] pl-3 pr-1 font-mono text-[12px] font-medium text-white/75",
        "transition-colors duration-200 hover:border-white/25 hover:text-white",
        className,
      )}
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={value}
          aria-label={value}
          className="relative inline-flex items-center gap-1.5 rounded-full after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] hover:text-white"
        >
          {text}
        </a>
      ) : (
        <span title={value} className="inline-flex items-center gap-1.5">
          {text}
          <span className="sr-only">{value}</span>
        </span>
      )}
      <button
        type="button"
        onClick={onCopy}
        className="relative inline-flex h-6 min-w-6 items-center after:absolute after:-inset-2.5 after:content-[''] justify-center rounded-full px-1 text-white/50 opacity-80 transition-opacity duration-150 hover:bg-white/10 hover:text-white hover:opacity-100 focus-visible:opacity-100"
      >
        {copy === "idle" ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            <span className="sr-only">Copy {value}</span>
          </>
        ) : (
          <span className="text-[11px]">{copy === "copied" ? "Copied" : "Copy failed"}</span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : ""}
      </span>
    </span>
  );
}
