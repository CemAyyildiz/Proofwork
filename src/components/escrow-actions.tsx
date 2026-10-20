"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  offerStep = true,
  blocked = false,
  canAbandon = false,
}: {
  campaignId: string;
  funderPubkey: string;
  stage: Stage;
  /** False for a campaign whose deadline passed before it was funded: deploy and fund are not offered, abandon still is. */
  offerStep?: boolean;
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
  // The forward step is the surface's one yellow action; while it is blocked, the readiness panel's fix is.
  const stepVariant = blocked ? "secondary" : "primary";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {stage === "draft" && offerStep ? (
          <Button variant={stepVariant} disabled={busy !== null || blocked} busy={busy === "deploy"} busyLabel="Waiting for wallet…" onClick={() => run("deploy")}>
            1 · Deploy escrow
          </Button>
        ) : null}
        {stage === "deployed" && offerStep ? (
          <Button variant={stepVariant} disabled={busy !== null || blocked} busy={busy === "fund"} busyLabel="Waiting for wallet…" onClick={() => run("fund")}>
            2 · Fund budget
          </Button>
        ) : null}
        {stage === "funded" ? <span className="text-sm text-pass">Funded. Contributors can submit.</span> : null}
        {error ? <span className="text-sm text-fail">{error}</span> : null}
      </div>
      {stage === "deployed" && canAbandon ? (
        confirming ? (
          <div className="max-w-[640px] space-y-3 rounded-lg border border-fail-line p-4 text-sm text-text-2">
            <p>
              Nothing is in this escrow: no fund transaction was ever sent for it, and the escrow is read to confirm it is empty
              before anything changes. Abandoning closes the campaign and frees its place under your limits. It cannot be funded
              afterwards.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="danger" size="sm" disabled={busy !== null} busy={busy === "abandon"} busyLabel="Closing…" onClick={() => void abandon()}>
                Abandon campaign
              </Button>
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-11 items-center text-sm text-fail underline hover:no-underline disabled:opacity-35 md:min-h-0"
          >
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
