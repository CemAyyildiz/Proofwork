"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publicEnv } from "@/config/public-env";
import { signTransaction } from "@/wallet/kit";
import { describeRelease, releaseSelected, type PreparedRelease, type ReleasedPayout, type ReleaseResult } from "./release-flow";

export interface PayoutRow {
  submissionId: string;
  shortId: string;
  workUrl: string;
  contributor: string;
  status: string;
  outcome: string | null;
  reasonCode: string | null;
  note: string | null;
  decisionId: string | null;
  payoutStatus: string | null;
  releaseTxHash: string | null;
  /** The payout's milestone on chain, once one is appended. */
  milestoneIndex: number | null;
}

interface Counts {
  toRelease: number; // payouts in "approved", waiting for the funder's release signature
}

export function PayoutActions({ campaignId, funderPubkey, rows, counts, closed }: { campaignId: string; funderPubkey: string; rows: PayoutRow[]; counts: Counts; closed: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ result: ReleaseResult; total: number } | null>(null);

  // A payout stuck before approval can be re-selected: the server resumes it from chain state.
  const resumable = new Set<string | null>([null, "milestone_added", "delivered"]);
  const eligible = rows.filter((r) => r.status === "decided" && r.outcome === "PASS" && resumable.has(r.payoutStatus));
  const releasable = rows.filter((r) => r.payoutStatus === "approved");
  const awaiting = rows.filter((r) => r.status === "pending" || r.status === "appealed").length;
  // One selection for both actions; each acts only on the selected rows it applies to.
  const toApprove = eligible.filter((r) => selected.has(r.submissionId)).map((r) => r.submissionId);
  const toRelease = releasable.filter((r) => selected.has(r.submissionId)).map((r) => r.submissionId);

  async function api<T>(body: unknown): Promise<T> {
    const res = await fetch(`/api/campaigns/${campaignId}/payouts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as T & { message?: string };
    if (!res.ok) throw new Error(json.message ?? `request failed (${res.status})`);
    return json;
  }

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError(null);
    setMsg(null);
    setOutcome(null);
    try {
      setMsg(await fn());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  // The approved rows stay selected, so the next click releases them.
  const approveSelected = () =>
    run("approve", async () => {
      const r = await api<{ appended: number }>({ action: "approve", submissionIds: toApprove });
      return `${r.appended} new milestone(s) added; the selected payouts are delivered and approved. Sign the release to pay.`;
    });

  async function releaseChosen() {
    const ids = [...toRelease];
    setBusy("release");
    setError(null);
    setMsg(null);
    setOutcome(null);
    try {
      const result = await releaseSelected({
        submissionIds: ids,
        prepare: async (submissionIds) => (await api<{ ops: PreparedRelease[] }>({ action: "prepare", kind: "release", submissionIds })).ops[0] ?? null,
        sign: (xdr) => signTransaction(funderPubkey, xdr),
        submit: (op) => api<ReleasedPayout>({ action: "submit", kind: "release", ...op }),
        onProgress: (n, total) => setProgress(`Signing ${n} of ${total}…`),
      });
      setOutcome({ result, total: ids.length });
      router.refresh();
    } catch (e) {
      // releaseSelected reports every step's failure in its result; this is only a bug guard.
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setProgress(null);
      setBusy(null);
    }
  }

  const closeCampaign = () =>
    run("close", async () => {
      const { ops } = await api<{ ops: Array<{ opId: string; unsignedXdr: string }> }>({ action: "prepare", kind: "close" });
      const op = ops[0];
      if (!op) return "Nothing to sign.";
      const signedXdr = await signTransaction(funderPubkey, op.unsignedXdr);
      await api({ action: "submit", kind: "close", opId: op.opId, signedXdr });
      return "Campaign closed. The dispute resolver can now return the remainder.";
    });

  return (
    <div className="space-y-4">
      {/* No rows, no table: the controls below still render, so a campaign without submissions can be closed. */}
      <table className={rows.length > 0 ? "w-full text-sm" : "hidden"}>
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="py-1" />
            <th className="py-1">Submission</th>
            <th className="py-1">Rubric</th>
            <th className="py-1">Payout</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const canPick = (eligible.some((e) => e.submissionId === r.submissionId) || r.payoutStatus === "approved") && !closed;
            return (
              <tr key={r.submissionId} className="border-t border-neutral-200 align-top">
                <td className="py-2 pr-2">
                  {canPick ? (
                    <input
                      type="checkbox"
                      checked={selected.has(r.submissionId)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(r.submissionId);
                        else next.delete(r.submissionId);
                        setSelected(next);
                      }}
                    />
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <a className="underline" href={r.workUrl} target="_blank" rel="noreferrer">{r.shortId}</a>
                  <div className="text-xs text-neutral-500">{r.contributor.slice(0, 6)}…{r.contributor.slice(-4)} · {r.status}</div>
                </td>
                <td className="py-2 pr-3">
                  {r.outcome ? (
                    <>
                      <strong>{r.outcome}</strong> {r.reasonCode}
                      {r.decisionId ? (
                        <>
                          {" · "}
                          <Link className="text-xs underline" href={`/verify/${r.decisionId}`}>verify</Link>
                        </>
                      ) : null}
                      <div className="text-xs text-neutral-600">{r.note}</div>
                    </>
                  ) : (
                    <span className="text-neutral-500">awaiting review</span>
                  )}
                </td>
                <td className="py-2">
                  {r.payoutStatus ?? "—"}
                  {r.releaseTxHash ? (
                    <a className="ml-1 text-xs underline" href={publicEnv.explorerTxUrl(r.releaseTxHash)} target="_blank" rel="noreferrer">
                      tx
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!closed ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy !== null || toApprove.length === 0} onClick={approveSelected} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {busy === "approve" ? "Adding milestones…" : `Approve ${toApprove.length} for payout`}
          </button>
          <button type="button" disabled={busy !== null || toRelease.length === 0} onClick={releaseChosen} className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">
            {busy === "release" ? (progress ?? "Preparing…") : `Release ${toRelease.length} payout(s)`}
          </button>
          <button
            type="button"
            disabled={busy !== null || counts.toRelease > 0 || awaiting > 0}
            title={
              awaiting > 0
                ? `${awaiting} submission(s) still awaiting review`
                : counts.toRelease > 0
                  ? `${counts.toRelease} approved payout(s) not yet released`
                  : undefined
            }
            onClick={closeCampaign}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            {busy === "close" ? "Signing…" : "Close campaign"}
          </button>
        </div>
      ) : null}
      {releasable.length > 0 && toRelease.length === 0 && !closed ? <p className="text-sm text-neutral-600">Tick the approved rows to release them.</p> : null}
      {awaiting > 0 && !closed ? (
        <p className="text-sm text-neutral-600">
          {awaiting} submission(s) awaiting review. Score them on the <Link className="underline" href="/review">review page</Link>, then approve the passes here.
        </p>
      ) : null}
      {outcome ? <ReleaseOutcomeLine result={outcome.result} total={outcome.total} rows={rows} /> : null}
      {msg ? <p className="text-sm text-green-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

const TONE = { ok: "text-green-700", muted: "text-neutral-600", fail: "text-red-600" } as const;

/** What a release run did: every payout released with its tx link, then what was not sent and why. */
function ReleaseOutcomeLine({ result, total, rows }: { result: ReleaseResult; total: number; rows: PayoutRow[] }) {
  const o = describeRelease(result, total);
  return (
    <p role="status" className={`text-sm ${TONE[o.tone]}`}>
      {o.headline ? (
        <>
          {o.headline} (
          {result.released.map((r, i) => (
            <span key={r.txHash}>
              {i > 0 ? ", " : null}
              <a className="underline" href={publicEnv.explorerTxUrl(r.txHash)} target="_blank" rel="noreferrer">
                {rows.find((row) => row.milestoneIndex === r.milestoneIndex)?.shortId ?? `#${r.milestoneIndex}`}
              </a>
            </span>
          ))}
          ).{o.detail ? " " : null}
        </>
      ) : null}
      {o.detail}
    </p>
  );
}
