"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  SubRosaClient,
  createSealedProposalRound,
  fetchRoundSignature,
  openPayload,
  quicknet,
  sealProposal,
} from "@sub-rosa/sdk";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ax } from "@/components/workspace/kit";
import { publicEnv } from "@/config/public-env";
import { formatDateShort } from "@/lib/format";
import { evaluate, SIGNALS, type ReasonCode, type Signals } from "@/domain/rubric";
import { assessmentOutcome, assessmentsAgree, sealedAssessmentJson, type SealedAssessment } from "@/domain/sealed-review";
import { signAuthEntry, signTransaction } from "@/wallet/kit";

interface Assignment {
  reviewerPubkey: string;
  commitment: string | null;
  commitTxHash: string | null;
  revealTxHash: string | null;
}

interface View {
  round: {
    id: string;
    status: "draft" | "open" | "revealing" | "cleared" | "finalizing" | "finalized" | "expired" | "failed";
    itemRef: string;
    schemaRef: string;
    contractId: string | null;
    roundId: string | null;
    revealRound: number;
    commitDeadline: string | Date;
    revealDeadline: string | Date;
    auditorPubkey: string;
    operatorPubkey: string;
    receiptSha256: string | null;
    receiptVerified: boolean;
    finalDecisionId: string | null;
  };
  campaign: { id: string; slug: string; title: string; brief: string; creatorPubkey: string };
  submission: { id: string; shortId: string; workUrl: string };
  reviewers: string[];
  assignments: Assignment[];
  revealed: Array<{ reviewerPubkey: string; review: Record<string, unknown> | null }>;
  finalDecision: { id: string; outcome: "PASS" | "FAIL" } | null;
  payout: { status: "milestone_added" | "delivered" | "approved" | "released" | "failed"; releaseTxHash: string | null } | null;
  manager: boolean;
  assigned: boolean;
  admin: boolean;
}

const ALL_PASS = Object.fromEntries(SIGNALS.map((signal) => [signal.id, true])) as Signals;

function bytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("invalid hex round parameter");
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
}

function client(address: string): SubRosaClient {
  return new SubRosaClient({
    network: publicEnv.network,
    publicKey: address,
    signTransaction: async (xdr) => ({ signedTxXdr: await signTransaction(address, xdr), signerAddress: address }),
    signAuthEntry: async (entry) => ({ signedAuthEntry: await signAuthEntry(address, entry), signerAddress: address }),
  });
}

function submittedHash(value: SubRosaClient): string {
  const hash = value.submittedTransactionHashes.at(-1);
  if (!hash) throw new Error("Sub Rosa did not return a transaction hash.");
  return hash;
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/sealed-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json["message"] === "string" ? json["message"] : "Sealed review action failed.");
  return json;
}

export function SealedReviewWorkspace({ view, address }: { view: View; address: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signals>(ALL_PASS);
  const [reason, setReason] = useState<ReasonCode>("R00_PASS");
  const [note, setNote] = useState("");
  const mine = view.assignments.find((assignment) => assignment.reviewerPubkey === address);
  const assessments = useMemo(
    () => view.revealed.flatMap((entry) => (entry.review ? [{ reviewer: entry.reviewerPubkey, review: entry.review as unknown as SealedAssessment }] : [])),
    [view.revealed],
  );

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sealed review action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function createRound(): Promise<string> {
    const sdk = client(address);
    const roundId = await createSealedProposalRound(sdk, {
      itemRef: bytes(view.round.itemRef),
      revealRound: view.round.revealRound,
      commitDeadline: Math.floor(new Date(view.round.commitDeadline).getTime() / 1000),
      revealDeadline: Math.floor(new Date(view.round.revealDeadline).getTime() / 1000),
      auditorPubkey: bytes(view.round.auditorPubkey),
      eligibleParticipants: view.reviewers,
      maxParticipants: 2,
    });
    await post({ action: "register", sealedReviewId: view.round.id, roundId: roundId.toString(), txHash: submittedHash(sdk) });
    return `ReceiptOnly round ${roundId.toString()} created and verified.`;
  }

  async function commit(): Promise<string> {
    if (!view.round.roundId) throw new Error("Round has not been created.");
    if (note.trim().length < 3) throw new Error("Write a note of at least 3 characters.");
    const result = evaluate(signals);
    const selectedReason = result.outcome === "PASS" ? "R00_PASS" : reason;
    const assessment: SealedAssessment = {
      v: 1,
      roundId: view.round.roundId,
      campaignId: view.campaign.id,
      submissionId: view.submission.id,
      rubric: "v2",
      reviewer: address,
      signals,
      reasonCode: selectedReason,
      note: note.trim(),
    };
    const sealed = await sealProposal({
      round: view.round.revealRound,
      drand: quicknet(),
      identity: new TextEncoder().encode(address),
      auditorPublicKey: bytes(view.round.auditorPubkey),
      proposal: { timelineDays: 1, approach: sealedAssessmentJson(assessment), metadata: { application: "proofwork", rubric: "v2" } },
    });
    const sdk = client(address);
    await sdk.submitV2({ roundId: BigInt(view.round.roundId), sealed, escrow: 0n });
    await post({ action: "commit", sealedReviewId: view.round.id, txHash: submittedHash(sdk) });
    return "Assessment sealed on Stellar. Its plaintext was not sent to Proofwork.";
  }

  async function openReveal(): Promise<string> {
    if (!view.round.roundId) throw new Error("Round has not been created.");
    const signature = await fetchRoundSignature(quicknet(), view.round.revealRound);
    const sdk = client(address);
    await sdk.openRevealV2(BigInt(view.round.roundId), signature);
    return `Reveal opened in transaction ${submittedHash(sdk)}.`;
  }

  async function reveal(): Promise<string> {
    if (!view.round.roundId) throw new Error("Round has not been created.");
    const sdk = client(address);
    const seal = await sdk.getSealV2(BigInt(view.round.roundId), address);
    if (!seal) throw new Error("Sealed payload is unavailable or expired.");
    const envelope = await openPayload(seal.ciphertext, quicknet());
    await sdk.revealV2({ roundId: BigInt(view.round.roundId), bidder: address, envelope });
    await post({ action: "reveal", sealedReviewId: view.round.id, txHash: submittedHash(sdk) });
    return "Assessment revealed and its commitment verified on-chain.";
  }

  async function clear(): Promise<string> {
    if (!view.round.roundId) throw new Error("Round has not been created.");
    const sdk = client(address);
    await sdk.clearV2(BigInt(view.round.roundId));
    const response = await post({ action: "clear", sealedReviewId: view.round.id, txHash: submittedHash(sdk) });
    return `Canonical receipt verified: ${String(response["receiptSha256"] ?? "")}`;
  }

  async function finalize(reviewer: string): Promise<string> {
    const response = await post({ action: "finalize", sealedReviewId: view.round.id, selectedReviewer: reviewer });
    return `Final Proofwork decision recorded: ${String(response["decisionId"] ?? "")}`;
  }

  async function payoutPost(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(view.campaign.id)}/payouts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof json["message"] === "string" ? json["message"] : "Reward action failed.");
    return json;
  }

  async function approveReward(): Promise<string> {
    await payoutPost({ action: "approve", submissionIds: [view.submission.id] });
    return "Reward milestone approved after founder decision. No funds moved yet.";
  }

  async function releaseReward(): Promise<string> {
    const prepared = await payoutPost({ action: "prepare", kind: "release", submissionIds: [view.submission.id] });
    const op = (prepared["ops"] as Array<{ opId: string; unsignedXdr: string }> | undefined)?.[0];
    if (!op) throw new Error("No releasable reward is available.");
    const signedXdr = await signTransaction(address, op.unsignedXdr);
    const result = await payoutPost({ action: "submit", kind: "release", opId: op.opId, signedXdr });
    return `Reward released in transaction ${String(result["txHash"] ?? "")}.`;
  }

  const outcome = evaluate(signals).outcome;
  return (
    <div className="space-y-5">
      {notice ? <p role="status" className="rounded-[20px] border border-accent/30 bg-accent/[0.06] px-5 py-3.5 text-sm text-white/80">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-[20px] border border-fail-line bg-fail-soft px-5 py-3.5 text-sm text-fail">{error}</p> : null}

      <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[12px] font-semibold text-white/55">{view.submission.shortId}</p>
            <h2 className="mt-2 font-display text-[clamp(1.8rem,3vw,2.6rem)] leading-[0.92]" style={{ fontVariationSettings: ax(85, 840) }}>{view.campaign.title}</h2>
          </div>
          <Pill tone={view.round.receiptVerified ? "pass" : "wait"}>{view.round.status}</Pill>
        </div>
        <p data-surface="paper" className="mt-5 whitespace-pre-wrap rounded-[20px] bg-paper p-5 text-[15px] leading-relaxed text-paper-ink [overflow-wrap:anywhere]">{view.campaign.brief}</p>
        <a href={view.submission.workUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-11 items-center rounded-full border border-white/15 px-5 text-sm font-semibold transition-colors hover:border-white/40">Open submission on X ↗</a>
        <dl className="mt-6 grid gap-4 border-t border-white/[0.07] pt-5 text-[13px] text-white/75 md:grid-cols-2">
          <div><dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/60">Sub Rosa contract</dt><dd className="mt-1 break-all font-mono">{view.round.contractId ?? "Not created"}</dd></div>
          <div><dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/60">Round</dt><dd className="mt-1 font-mono">{view.round.roundId ?? "Not created"}</dd></div>
          <div><dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/60">Commit deadline</dt><dd className="mt-1">{formatDateShort(new Date(view.round.commitDeadline))}</dd></div>
          <div><dt className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/60">Reveal deadline</dt><dd className="mt-1">{formatDateShort(new Date(view.round.revealDeadline))}</dd></div>
        </dl>
        {view.manager && view.round.status === "draft" ? <Button className="mt-6" busy={busy === "create"} busyLabel="Creating on Stellar…" onClick={() => void run("create", createRound)}>Create ReceiptOnly round</Button> : null}
      </section>

      <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
        <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>Reviewer status</h2>
        <ul className="mt-4 divide-y divide-white/[0.06]">
          {view.assignments.map((assignment) => (
            <li key={assignment.reviewerPubkey} className="grid gap-1 py-3.5 text-[13px] md:grid-cols-[140px_1fr_auto] md:items-center">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/60">{assignment.reviewerPubkey === view.campaign.creatorPubkey ? "Campaign creator" : "Founder"}</span>
              <span className="truncate font-mono text-white/75">{assignment.reviewerPubkey}</span>
              <span className={assignment.revealTxHash || assignment.commitTxHash ? "font-semibold text-accent" : "text-white/60"}>{assignment.revealTxHash ? "Revealed" : assignment.commitTxHash ? "Sealed" : "Waiting"}</span>
            </li>
          ))}
        </ul>
      </section>

      {mine && view.round.status === "open" && !mine.commitTxHash ? (
        <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
          <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>Your sealed rubric v2 assessment</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/55">Only ciphertext and its commitment leave this browser before the common reveal boundary.</p>
          <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-2">
            {SIGNALS.map((signal, i) => (
              <label key={signal.id} className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-[18px] border border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-[15px] font-semibold transition-colors has-[input:not(:checked)]:border-fail-line has-[input:not(:checked)]:bg-fail-soft has-[input:not(:checked)]:text-fail">
                <span className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="w-6 font-display text-[22px] leading-none text-white/25" style={{ fontVariationSettings: ax(70, 900) }}>{i + 1}</span>{signal.label}</span>
                <input type="checkbox" className="size-5 shrink-0 cursor-pointer accent-[var(--color-accent)]" checked={signals[signal.id]} onChange={(event) => {
                  const next = { ...signals, [signal.id]: event.target.checked };
                  setSignals(next);
                  const failed = SIGNALS.find((candidate) => !next[candidate.id]);
                  setReason(evaluate(next).outcome === "PASS" ? "R00_PASS" : (failed?.failCode ?? "R01_ACCOUNT"));
                }} />
              </label>
            ))}
          </div>
          {outcome === "FAIL" ? (
            <label className="mt-5 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">Primary failed signal
              <select value={reason} onChange={(event) => setReason(event.target.value as ReasonCode)} className="mt-2 h-12 w-full rounded-[16px] border border-white/10 bg-white/[0.03] px-4 font-sans text-[15px] normal-case tracking-normal text-text">
                {SIGNALS.filter((signal) => !signals[signal.id]).map((signal) => <option key={signal.failCode} value={signal.failCode}>{signal.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="mt-5 block font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">Note to contributor
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 font-sans text-[15px] normal-case tracking-normal text-text outline-none focus-visible:border-accent" />
          </label>
          <Button className="mt-5" busy={busy === "commit"} busyLabel="Sealing on Stellar…" onClick={() => void run("commit", commit)}>Seal {outcome}</Button>
        </section>
      ) : null}

      {view.round.roundId && (view.round.status === "open" || view.round.status === "revealing") ? (
        <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
          <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>Timed reveal</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/55">After Drand round {view.round.revealRound}, open reveal once, then each assigned wallet reveals its own assessment.</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {(view.manager || view.assigned) ? <Button variant="secondary" busy={busy === "open"} busyLabel="Opening…" onClick={() => void run("open", openReveal)}>Open reveal</Button> : null}
            {mine?.commitTxHash && !mine.revealTxHash ? <Button busy={busy === "reveal"} busyLabel="Revealing…" onClick={() => void run("reveal", reveal)}>Reveal my assessment</Button> : null}
            {(view.manager || view.assigned) && view.assignments.every((assignment) => assignment.revealTxHash) ? <Button busy={busy === "clear"} busyLabel="Clearing…" onClick={() => void run("clear", clear)}>Clear after deadline and verify receipt</Button> : null}
          </div>
        </section>
      ) : null}

      {view.round.receiptVerified && assessments.length === 2 ? (
        <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>Verified comparison</h2>
            <Pill tone={assessmentsAgree(assessments[0]!.review, assessments[1]!.review) ? "pass" : "fail"}>
              {assessmentsAgree(assessments[0]!.review, assessments[1]!.review) ? "Agree" : "Disagree"}
            </Pill>
          </div>
          <p className="mt-3 break-all font-mono text-[11.5px] text-white/60">Receipt SHA-256 · {view.round.receiptSha256}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {assessments.map(({ reviewer, review }, index) => (
              <div key={reviewer} data-surface="paper" className="rounded-[22px] bg-paper p-5 text-paper-ink">
                <p className="font-mono text-[11px] text-black/65">{`Reviewer ${index + 1} · ${reviewer.slice(0, 8)}…${reviewer.slice(-6)}`}</p>
                <p className="mt-3 inline-block -rotate-3 rounded-lg border-[3px] border-black px-3 font-display text-[30px] leading-tight" style={{ fontVariationSettings: ax(70, 900) }}>{assessmentOutcome(review)}</p>
                <p className="mt-3 text-[15px] leading-relaxed">{review.note}</p>
                {view.admin && view.round.status === "cleared" ? <Button className="mt-4" size="sm" busy={busy === `final-${reviewer}`} busyLabel="Recording…" onClick={() => void run(`final-${reviewer}`, () => finalize(reviewer))}>Use as founder decision</Button> : null}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12.5px] text-white/60">Only the configured founder wallet can write Proofwork&apos;s final decision ledger record.</p>
        </section>
      ) : null}

      {view.admin && view.round.status === "finalized" && view.finalDecision?.outcome === "PASS" ? (
        <section className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6 md:p-8">
          <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>Founder-authorized reward</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-white/55">The campaign creator is not the escrow release signer. Approval is accepted only from this founder session; release requires this wallet&apos;s Stellar signature.</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {!view.payout || view.payout.status === "failed" || view.payout.status === "milestone_added" || view.payout.status === "delivered" ? (
              <Button busy={busy === "approve-reward"} busyLabel="Approving…" onClick={() => void run("approve-reward", approveReward)}>Approve reward</Button>
            ) : null}
            {view.payout?.status === "approved" ? (
              <Button busy={busy === "release-reward"} busyLabel="Waiting for signature…" onClick={() => void run("release-reward", releaseReward)}>Sign and release reward</Button>
            ) : null}
            {view.payout?.status === "released" ? <Pill tone="pass">Reward released</Pill> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
