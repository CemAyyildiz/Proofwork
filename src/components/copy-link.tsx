"use client";

import { useState } from "react";

export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
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
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">{url}</code>
      <button type="button" onClick={copy} className="rounded border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-50">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
