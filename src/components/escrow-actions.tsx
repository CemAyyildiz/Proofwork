"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signTransaction } from "@/wallet/kit";

type Stage = "draft" | "deployed" | "funded" | "closed";

/**
 * Drives one wallet-signed escrow op: prepare → sign in wallet → submit.
 * The server refuses a signed XDR whose hash differs from what it prepared.
 */
export function EscrowActions({ campaignId, funderPubkey, stage }: { campaignId: string; funderPubkey: string; stage: Stage }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "deploy" | "fund") {
    setBusy(kind);
    setError(null);
    try {
      const prepared = await call<{ opId: string; unsignedXdr: string }>(campaignId, { action: "prepare", kind });
      const signedXdr = await signTransaction(funderPubkey, prepared.unsignedXdr);
      await call(campaignId, { action: "submit", kind, opId: prepared.opId, signedXdr });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  if (stage === "closed") return null;
  return (
    <div className="flex items-center gap-3">
      {stage === "draft" ? (
        <button type="button" disabled={busy !== null} onClick={() => run("deploy")} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {busy === "deploy" ? "Waiting for wallet…" : "1 · Deploy escrow"}
        </button>
      ) : null}
      {stage === "deployed" ? (
        <button type="button" disabled={busy !== null} onClick={() => run("fund")} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {busy === "fund" ? "Waiting for wallet…" : "2 · Fund budget"}
        </button>
      ) : null}
      {stage === "funded" ? <span className="text-sm text-green-700">Funded. Contributors can submit.</span> : null}
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}

async function call<T = unknown>(campaignId: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/campaigns/${campaignId}/escrow`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(json.message ?? `request failed (${res.status})`);
  return json;
}
