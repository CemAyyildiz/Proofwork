"use client";

import { useEffect, useState } from "react";

/** Recomputes SHA-256 of the canonical JSON in the browser with WebCrypto. */
export function HashCheck({ canonicalJson, expectedHash }: { canonicalJson: string; expectedHash: string }) {
  const [computed, setComputed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bytes = new TextEncoder().encode(canonicalJson);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      if (!cancelled) setComputed(hex);
    })();
    return () => {
      cancelled = true;
    };
  }, [canonicalJson]);

  const ok = computed !== null && computed === expectedHash;
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs">{canonicalJson}</pre>
      <p className="text-sm">
        Browser SHA-256: <code className="break-all text-xs">{computed ?? "computing…"}</code>
      </p>
      {computed !== null ? (
        <p className={ok ? "text-sm font-medium text-green-700" : "text-sm font-medium text-red-700"}>
          {ok ? "Matches the recorded hash." : "DOES NOT MATCH the recorded hash."}
        </p>
      ) : null}
    </div>
  );
}
