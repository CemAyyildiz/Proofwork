"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Candidate {
  submissionId: string;
  shortId: string;
  campaignId: string;
  campaignTitle: string;
}

export function SealedReviewCreate({ candidates }: { candidates: Candidate[] }) {
  const router = useRouter();
  const [submissionId, setSubmissionId] = useState(candidates[0]?.submissionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sealed-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare", submissionId, revealDelaySeconds: 600 }),
      });
      const json = (await res.json()) as { round?: { id?: string }; message?: string };
      if (!res.ok || !json.round?.id) throw new Error(json.message ?? "Could not prepare sealed review.");
      router.push(`/review/sealed/${encodeURIComponent(json.round.id)}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare sealed review.");
      setBusy(false);
    }
  }

  if (candidates.length === 0) return null;
  return (
    <Card className="p-5 md:p-6">
      <h2 className="text-base font-semibold">Prepare a sealed dual review</h2>
      <p className="mt-1 text-sm text-muted">Choose a pending submission. Reviewers are immutable: Proofwork&apos;s configured founder wallet and this campaign&apos;s original creator.</p>
      <div className="mt-4 grid gap-3">
        <label>
          <span className="text-[13px] text-text-2">Submission</span>
          <select value={submissionId} onChange={(event) => setSubmissionId(event.target.value)} className="mt-1.5 h-11 w-full rounded-md border border-line-strong bg-sunken px-3 text-sm">
            {candidates.map((candidate) => (
              <option key={candidate.submissionId} value={candidate.submissionId}>{`${candidate.shortId} · ${candidate.campaignTitle}`}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-fail">{error}</p> : null}
      <Button className="mt-4" busy={busy} busyLabel="Preparing…" disabled={!submissionId} onClick={() => void prepare()}>
        Prepare ReceiptOnly round
      </Button>
    </Card>
  );
}
