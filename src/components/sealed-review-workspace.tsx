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
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
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
  campaign: { id: string; slug: string; title: string; brief: string };
  submission: { id: string; shortId: string; workUrl: string };
  reviewers: string[];
  assignments: Assignment[];
  revealed: Array<{ reviewerPubkey: string; review: Record<string, unknown> | null }>;
  manager: boolean;
  assigned: boolean;
}

const ALL_PASS = Object.fromEntries(SIGNALS.map((signal) => [signal.id, true])) as Signals;

function bytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("invalid hex round parameter");
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
}

function client(address: string): SubRosaClient {
  return new SubRosaClient({
    network: "testnet",
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

  const outcome = evaluate(signals).outcome;
  return (
    <div className="space-y-5">
      {notice ? <p role="status" className="rounded-lg border border-line-strong bg-raised px-4 py-3 text-sm text-text-2">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-fail-line bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p> : null}

      <Card className="p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">{view.submission.shortId}</p>
            <h2 className="mt-1 text-xl font-semibold">{view.campaign.title}</h2>
          </div>
          <Pill tone={view.round.receiptVerified ? "pass" : "wait"}>{view.round.status}</Pill>
        </div>
        <p className="mt-3 text-sm text-text-2">{view.campaign.brief}</p>
        <a href={view.submission.workUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-accent hover:underline">Open submission on X ↗</a>
        <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-xs text-text-2 md:grid-cols-2">
          <div><dt className="text-muted">Sub Rosa contract</dt><dd className="mt-1 break-all font-mono">{view.round.contractId ?? "Not created"}</dd></div>
          <div><dt className="text-muted">Round</dt><dd className="mt-1 font-mono">{view.round.roundId ?? "Not created"}</dd></div>
          <div><dt className="text-muted">Commit deadline</dt><dd className="mt-1">{new Date(view.round.commitDeadline).toLocaleString()}</dd></div>
          <div><dt className="text-muted">Reveal deadline</dt><dd className="mt-1">{new Date(view.round.revealDeadline).toLocaleString()}</dd></div>
        </dl>
        {view.manager && view.round.status === "draft" ? <Button className="mt-5" busy={busy === "create"} busyLabel="Creating on testnet…" onClick={() => void run("create", createRound)}>Create ReceiptOnly round</Button> : null}
      </Card>

      <Card className="p-5 md:p-6">
        <h2 className="text-base font-semibold">Reviewer status</h2>
        <ul className="mt-3 divide-y divide-line">
          {view.assignments.map((assignment, index) => (
            <li key={assignment.reviewerPubkey} className="grid gap-1 py-3 text-xs md:grid-cols-[120px_1fr_auto] md:items-center">
              <span className="text-muted">{`Reviewer ${index + 1}`}</span>
              <span className="truncate font-mono">{assignment.reviewerPubkey}</span>
              <span className="text-text-2">{assignment.revealTxHash ? "Revealed" : assignment.commitTxHash ? "Sealed" : "Waiting"}</span>
            </li>
          ))}
        </ul>
      </Card>

      {mine && view.round.status === "open" && !mine.commitTxHash ? (
        <Card className="p-5 md:p-6">
          <h2 className="text-base font-semibold">Your sealed rubric v2 assessment</h2>
          <p className="mt-1 text-sm text-muted">Only ciphertext and its commitment leave this browser before the common reveal boundary.</p>
          <div className="mt-4 grid gap-2">
            {SIGNALS.map((signal) => (
              <label key={signal.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-sunken px-3 py-2 text-sm">
                <span>{signal.label}</span>
                <input type="checkbox" checked={signals[signal.id]} onChange={(event) => {
                  const next = { ...signals, [signal.id]: event.target.checked };
                  setSignals(next);
                  const failed = SIGNALS.find((candidate) => !next[candidate.id]);
                  setReason(evaluate(next).outcome === "PASS" ? "R00_PASS" : (failed?.failCode ?? "R01_ACCOUNT"));
                }} />
              </label>
            ))}
          </div>
          {outcome === "FAIL" ? (
            <label className="mt-4 block text-sm">Primary failed signal
              <select value={reason} onChange={(event) => setReason(event.target.value as ReasonCode)} className="mt-1.5 h-11 w-full rounded-md border border-line-strong bg-sunken px-3">
                {SIGNALS.filter((signal) => !signals[signal.id]).map((signal) => <option key={signal.failCode} value={signal.failCode}>{signal.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="mt-4 block text-sm">Note to contributor
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} className="mt-1.5 w-full rounded-md border border-line-strong bg-sunken px-3 py-2" />
          </label>
          <Button className="mt-4" busy={busy === "commit"} busyLabel="Sealing on testnet…" onClick={() => void run("commit", commit)}>Seal {outcome}</Button>
        </Card>
      ) : null}

      {view.round.roundId && (view.round.status === "open" || view.round.status === "revealing") ? (
        <Card className="p-5 md:p-6">
          <h2 className="text-base font-semibold">Timed reveal</h2>
          <p className="mt-1 text-sm text-muted">After Drand round {view.round.revealRound}, open reveal once, then each assigned wallet reveals its own assessment.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(view.manager || view.assigned) ? <Button variant="secondary" busy={busy === "open"} busyLabel="Opening…" onClick={() => void run("open", openReveal)}>Open reveal</Button> : null}
            {mine?.commitTxHash && !mine.revealTxHash ? <Button busy={busy === "reveal"} busyLabel="Revealing…" onClick={() => void run("reveal", reveal)}>Reveal my assessment</Button> : null}
            {(view.manager || view.assigned) && view.assignments.every((assignment) => assignment.revealTxHash) ? <Button busy={busy === "clear"} busyLabel="Clearing…" onClick={() => void run("clear", clear)}>Clear after deadline and verify receipt</Button> : null}
          </div>
        </Card>
      ) : null}

      {view.round.receiptVerified && assessments.length === 2 ? (
        <Card className="p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Verified comparison</h2>
            <Pill tone={assessmentsAgree(assessments[0]!.review, assessments[1]!.review) ? "pass" : "fail"}>
              {assessmentsAgree(assessments[0]!.review, assessments[1]!.review) ? "Agree" : "Disagree"}
            </Pill>
          </div>
          <p className="mt-2 break-all font-mono text-xs text-muted">Receipt SHA-256 · {view.round.receiptSha256}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {assessments.map(({ reviewer, review }, index) => (
              <div key={reviewer} className="rounded-lg border border-line bg-sunken p-4">
                <p className="font-mono text-xs text-muted">{`Reviewer ${index + 1} · ${reviewer.slice(0, 8)}…${reviewer.slice(-6)}`}</p>
                <p className="mt-2 text-lg font-semibold">{assessmentOutcome(review)}</p>
                <p className="mt-2 text-sm text-text-2">{review.note}</p>
                {view.round.status === "cleared" ? <Button className="mt-4" size="sm" busy={busy === `final-${reviewer}`} busyLabel="Recording…" onClick={() => void run(`final-${reviewer}`, () => finalize(reviewer))}>Use as final decision</Button> : null}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">Only this final action writes Proofwork’s decision ledger. Sub Rosa never authorizes or releases a payout.</p>
        </Card>
      ) : null}
    </div>
  );
}
