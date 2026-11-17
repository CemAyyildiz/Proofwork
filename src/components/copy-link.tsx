"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => undefined;

export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  // The server renders the path; the browser adds its origin after hydration, so both first renders match.
  const url = useSyncExternalStore(
    noSubscribe,
    () => `${window.location.origin}${path}`,
    () => path,
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 font-mono text-xs text-text-2">{url}</code>
      <button type="button" onClick={copy} className="h-9 shrink-0 rounded-full border border-white/20 px-4 text-xs font-semibold text-text transition-colors hover:bg-white hover:text-black">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
