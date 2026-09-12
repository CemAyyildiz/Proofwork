"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signTransaction } from "@/wallet/kit";

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

  const eligible = rows.filter((r) => r.status === "decided" && r.outcome === "PASS" && !r.payoutStatus);
  const awaiting = rows.filter((r) => r.status === "pending" || r.status === "appealed").length;

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
    try {
      setMsg(await fn());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  const approveSelected = () =>
    run("approve", async () => {
      const r = await api<{ appended: number }>({ action: "approve", submissionIds: [...selected] });
      setSelected(new Set());
      return `${r.appended} milestone(s) added to escrow, delivered and approved. Sign the release to pay.`;
    });

  const signAll = (kind: "release" | "close") =>
    run(kind, async () => {
      // One transaction at a time: each carries the wallet's sequence number.
      let n = 0;
      for (;;) {
        const { ops } = await api<{ ops: Array<{ opId: string; unsignedXdr: string; milestoneIndex: number | null }> }>({ action: "prepare", kind });
        const op = ops[0];
        if (!op) break;
        const signedXdr = await signTransaction(funderPubkey, op.unsignedXdr);
        await api({ action: "submit", kind, opId: op.opId, signedXdr });
        n += 1;
        if (kind === "close") break;
      }
      if (n === 0) return "Nothing to sign.";
      return kind === "close" ? "Campaign closed. The dispute resolver can now return the remainder." : `${n} ${kind} transaction(s) confirmed.`;
    });

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
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
            const canPick = eligible.some((e) => e.submissionId === r.submissionId) && !closed;
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
                    <a className="ml-1 text-xs underline" href={`https://stellar.expert/explorer/testnet/tx/${r.releaseTxHash}`} target="_blank" rel="noreferrer">
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
          <button type="button" disabled={busy !== null || selected.size === 0} onClick={approveSelected} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {busy === "approve" ? "Adding milestones…" : `Approve ${selected.size} for payout`}
          </button>
          <button type="button" disabled={busy !== null || counts.toRelease === 0} onClick={() => signAll("release")} className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">
            {busy === "release" ? "Signing…" : `Release ${counts.toRelease} payout(s)`}
          </button>
          <button
            type="button"
            disabled={busy !== null || counts.toRelease > 0 || awaiting > 0}
            title={awaiting > 0 ? `${awaiting} submission(s) still awaiting review` : undefined}
            onClick={() => signAll("close")}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            {busy === "close" ? "Signing…" : "Close campaign"}
          </button>
        </div>
      ) : null}
      {awaiting > 0 && !closed ? (
        <p className="text-sm text-neutral-600">
          {awaiting} submission(s) awaiting review. Score them on the <Link className="underline" href="/review">review page</Link>, then approve the passes here.
        </p>
      ) : null}
      {msg ? <p className="text-sm text-green-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
