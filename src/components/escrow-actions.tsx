"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signTransaction } from "@/wallet/kit";

type Stage = "draft" | "deployed" | "funded" | "closed";

/**
 * Drives one wallet-signed escrow op: prepare → sign in wallet → submit.
 * The server refuses a signed XDR whose hash differs from what it prepared.
 * On a deployed campaign that was never funded it also offers to abandon the
 * campaign, which signs nothing.
 */
export function EscrowActions({
  campaignId,
  funderPubkey,
  stage,
  blocked = false,
  canAbandon = false,
}: {
  campaignId: string;
  funderPubkey: string;
  stage: Stage;
  /** A limit is reached, or the wallet is not ready or could not be checked: deploy and fund stay off. The server refuses them as well. */
  blocked?: boolean;
  /** Deployed, not funded, and no fund transaction was ever sent: the campaign can be given up. */
  canAbandon?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function abandon() {
    setBusy("abandon");
    setError(null);
    try {
      await call(campaignId, { action: "abandon" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

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
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {stage === "draft" ? (
          <button type="button" disabled={busy !== null || blocked} onClick={() => run("deploy")} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {busy === "deploy" ? "Waiting for wallet…" : "1 · Deploy escrow"}
          </button>
        ) : null}
        {stage === "deployed" ? (
          <button type="button" disabled={busy !== null || blocked} onClick={() => run("fund")} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {busy === "fund" ? "Waiting for wallet…" : "2 · Fund budget"}
          </button>
        ) : null}
        {stage === "funded" ? <span className="text-sm text-green-700">Funded. Contributors can submit.</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
      {stage === "deployed" && canAbandon ? (
        confirming ? (
          <div className="max-w-[640px] space-y-2 rounded border border-red-300 p-3 text-sm">
            <p>
              Nothing is in this escrow: no fund transaction was ever sent for it. Abandoning closes the campaign and frees its place
              under your limits. It cannot be funded afterwards.
            </p>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy !== null} onClick={() => void abandon()} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50">
                {busy === "abandon" ? "Closing…" : "Abandon campaign"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => setConfirming(false)} className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => setConfirming(true)} className="text-sm text-red-700 underline disabled:opacity-50">
            Abandon this campaign instead
          </button>
        )
      ) : null}
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
