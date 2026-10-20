"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CloseBlocker } from "@/domain/campaign-status";
import { signTransaction } from "@/wallet/kit";
import { isSignatureRejection, walletErrorMessage } from "@/wallet/onboarding";
import { describeBlocker } from "./campaign-phase";
import { payoutsCall } from "./funder-api";

type Notice = { tone: "muted" | "fail"; text: string };

const message = (e: unknown) => (e instanceof Error ? e.message : walletErrorMessage(e));

/**
 * Close campaign: the one irreversible funder action, so it asks once more
 * before the wallet does. Every blocker is listed, and the button's title
 * carries them too. A blocker arriving with a refresh takes the confirmation
 * back down. The server checks the same conditions again.
 */
export function ClosePanel({
  campaignId,
  funderPubkey,
  blockers,
  unpaidPasses,
  ended,
  reviewer,
}: {
  campaignId: string;
  funderPubkey: string;
  blockers: CloseBlocker[];
  /** Passed submissions the funder has not approved; closing leaves them unpaid. */
  unpaidPasses: number;
  /** The deadline has passed: submissions are already shut. */
  ended: boolean;
  reviewer: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const reasons = blockers.map(describeBlocker);
  const blocked = reasons.length > 0;
  const blockKey = reasons.join("|");

  // Re-checked whenever the blockers change: a new one takes the confirmation down.
  const [seenKey, setSeenKey] = useState(blockKey);
  if (seenKey !== blockKey) {
    setSeenKey(blockKey);
    if (blockKey !== "") setConfirming(false);
  }

  async function close() {
    setBusy(true);
    setNotice(null);
    let op: { opId: string; unsignedXdr: string } | undefined;
    try {
      op = (await payoutsCall<{ ops: Array<{ opId: string; unsignedXdr: string }> }>(campaignId, { action: "prepare", kind: "close" })).ops[0];
    } catch (e) {
      setNotice({ tone: "fail", text: `Close refused: ${message(e)}. Nothing was sent.` });
      setBusy(false);
      router.refresh();
      return;
    }
    if (!op) {
      setNotice({ tone: "muted", text: "Nothing to sign." });
      setBusy(false);
      router.refresh();
      return;
    }
    let signedXdr: string;
    try {
      signedXdr = await signTransaction(funderPubkey, op.unsignedXdr);
    } catch (e) {
      setNotice(isSignatureRejection(e) ? { tone: "muted", text: "Signature cancelled in your wallet. Nothing was sent." } : { tone: "fail", text: `${message(e)}. Nothing was sent.` });
      setBusy(false);
      return;
    }
    try {
      await payoutsCall(campaignId, { action: "submit", kind: "close", opId: op.opId, signedXdr });
      setConfirming(false);
      setNotice({ tone: "muted", text: "Campaign closed. The dispute resolver can now return the remainder." });
    } catch (e) {
      setNotice({ tone: "fail", text: `The close may have reached the chain; refresh to see (${message(e)}).` });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[560px]">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Close campaign</h3>
          <p className="mt-1.5 text-sm leading-normal text-text-2">
            {ended ? "Submissions are shut. " : "Closing now stops new submissions before the deadline. "}
            Closing records the end on Stellar; the dispute resolver then returns what is left in escrow to the funder&apos;s wallet.
          </p>
        </div>
        {!confirming ? (
          <Button variant="danger" size="sm" disabled={blocked || busy} title={blocked ? reasons.join("; ") : undefined} onClick={() => setConfirming(true)}>
            Close campaign
          </Button>
        ) : null}
      </div>

      {blocked ? (
        <div className="mt-4 rounded-lg border border-line bg-sunken p-3.5">
          <p className="text-[13px] font-medium text-text">Close is off until these clear</p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-text-2">
            {reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
                {r}
              </li>
            ))}
          </ul>
          {reviewer && blockers.some((b) => b.kind === "review") ? (
            <Link href="/review" className="mt-2 inline-flex min-h-9 items-center text-[13px] font-medium text-text hover:underline">
              Open the review queue →
            </Link>
          ) : null}
        </div>
      ) : null}

      {confirming && !blocked ? (
        <div className="mt-4 rounded-lg border border-fail-line bg-fail-soft p-4">
          <p className="text-sm font-medium text-text">This cannot be undone.</p>
          <p className="mt-1.5 text-[13px] leading-normal text-text-2">
            The campaign takes no new submissions or payouts after this.
            {unpaidPasses > 0
              ? ` ${unpaidPasses} passed ${unpaidPasses === 1 ? "submission stays" : "submissions stay"} unpaid; approve and release ${unpaidPasses === 1 ? "it" : "them"} first if you mean to pay.`
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="danger" size="sm" busy={busy} busyLabel="Waiting for wallet…" onClick={() => void close()}>
              Sign and close
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it open
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p role={notice.tone === "fail" ? "alert" : "status"} className={notice.tone === "fail" ? "mt-3 text-sm text-fail" : "mt-3 text-sm text-muted"}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
