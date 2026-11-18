"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ax } from "@/components/workspace/kit";

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
    <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
      <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>
        Prepare a sealed dual review
      </h2>
      <p className="mt-3 max-w-[640px] text-[14px] leading-relaxed text-white/55">Choose a pending submission. Reviewers are immutable: Proofwork&apos;s configured founder wallet and this campaign&apos;s original creator.</p>
      <div className="mt-5 grid gap-3">
        <label>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">Submission</span>
          <select value={submissionId} onChange={(event) => setSubmissionId(event.target.value)} className="mt-2 h-12 w-full rounded-[16px] border border-white/10 bg-white/[0.03] px-4 text-[15px] text-text">
            {candidates.map((candidate) => (
              <option key={candidate.submissionId} value={candidate.submissionId}>{`${candidate.shortId} · ${candidate.campaignTitle}`}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-[18px] border border-fail-line bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p> : null}
      <Button className="mt-5" busy={busy} busyLabel="Preparing…" disabled={!submissionId} onClick={() => void prepare()}>
        Prepare ReceiptOnly round
      </Button>
    </section>
  );
}
