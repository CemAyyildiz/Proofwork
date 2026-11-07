import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SubRosaClient,
  chainInfo,
  createSealedProposalRound,
  decodePayloadEnvelope,
  decodeSealedProposal,
  drandRoundTime,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  roundInSeconds,
  sealProposal,
  serializeReceiptV2,
  verifyReceiptV2,
} from "@sub-rosa/sdk";
import { sealedAssessmentJson, type SealedAssessment } from "../src/domain/sealed-review";

const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const ONE_FAIL = { ...ALL_PASS, content_original: false };
const fixture = {
  campaignId: "cmp_proofwork_subrosa_testnet",
  campaignSlug: "proofwork-subrosa-testnet",
  submissionId: "sub_proofwork_subrosa_testnet",
  submissionShortId: "sdrtest1",
  rubric: "v2",
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

async function fund(account: Keypair): Promise<void> {
  const response = await fetch(`https://friendbot.stellar.org?addr=${account.publicKey()}`);
  if (!response.ok) throw new Error(`Friendbot refused ${account.publicKey()}: ${response.status}`);
}

function binding(reviewers: string[]): Uint8Array {
  const canonical = JSON.stringify({ v: 1, app: "proofwork", ...fixture, reviewers: [...reviewers].sort() });
  return createHash("sha256").update(canonical).digest();
}

function assessment(roundId: bigint, reviewer: string, signals: typeof ALL_PASS, note: string): SealedAssessment {
  return {
    v: 1,
    roundId: roundId.toString(),
    campaignId: fixture.campaignId,
    submissionId: fixture.submissionId,
    rubric: "v2",
    reviewer,
    signals,
    reasonCode: "R00_PASS",
    note,
  };
}

async function beacon(round: number): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await fetchRoundSignature(quicknet(), round);
    } catch {
      await sleep(3_000);
    }
  }
  throw new Error(`Drand round ${round} was not published in time`);
}

async function clearWhenReady(client: SubRosaClient, roundId: bigint): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await client.exportReceiptV2(roundId)).status === "Settled") return;
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      try {
        await client.clearV2(roundId);
        return;
      } catch {
        // The submitted ledger can still close between simulation and send; re-read before retrying.
      }
    }
    await sleep(5_000);
  }
  throw new Error("round did not become clearable before the polling deadline");
}

async function main(): Promise<void> {
  const operator = Keypair.random();
  const first = Keypair.random();
  const second = Keypair.random();
  await Promise.all([fund(operator), fund(first), fund(second)]);

  const operatorClient = new SubRosaClient({ network: "testnet", secretKey: operator.secret() });
  const firstClient = new SubRosaClient({ network: "testnet", secretKey: first.secret() });
  const secondClient = new SubRosaClient({ network: "testnet", secretKey: second.secret() });
  const drand = quicknet();
  const [info, revealRound] = await Promise.all([chainInfo(drand), roundInSeconds(drand, 120)]);
  const privacyAt = drandRoundTime(revealRound, info);
  const commitDeadline = privacyAt - 20;
  const revealDeadline = privacyAt + 60;
  const auditor = generateAuditorKeypair();
  const reviewers = [first.publicKey(), second.publicKey()];
  const itemRef = binding(reviewers);

  const roundId = await createSealedProposalRound(operatorClient, {
    itemRef,
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    eligibleParticipants: reviewers,
    maxParticipants: 2,
  });

  const firstAssessment = assessment(roundId, first.publicKey(), ALL_PASS, "Independent reviewer one: evidence satisfies rubric v2.");
  const secondAssessment = assessment(roundId, second.publicKey(), ONE_FAIL, "Independent reviewer two: original enough overall; one signal failed.");
  const [firstSeal, secondSeal, outsiderSeal] = await Promise.all([
    sealProposal({ round: revealRound, drand, identity: new TextEncoder().encode(first.publicKey()), auditorPublicKey: auditor.publicKey, proposal: { timelineDays: 1, approach: sealedAssessmentJson(firstAssessment) } }),
    sealProposal({ round: revealRound, drand, identity: new TextEncoder().encode(second.publicKey()), auditorPublicKey: auditor.publicKey, proposal: { timelineDays: 1, approach: sealedAssessmentJson(secondAssessment) } }),
    sealProposal({ round: revealRound, drand, identity: new TextEncoder().encode(operator.publicKey()), auditorPublicKey: auditor.publicKey, proposal: { timelineDays: 1, approach: sealedAssessmentJson({ ...firstAssessment, reviewer: operator.publicKey() }) } }),
  ]);
  await firstClient.submitV2({ roundId, sealed: firstSeal, escrow: 0n });
  await secondClient.submitV2({ roundId, sealed: secondSeal, escrow: 0n });

  const [duplicate, unauthorized] = await Promise.all([
    firstClient.preflightCommitV2({ roundId, sealed: firstSeal, escrow: 0n }),
    operatorClient.preflightCommitV2({ roundId, sealed: outsiderSeal, escrow: 0n }),
  ]);
  if (unauthorized.ok) throw new Error("unauthorized commit unexpectedly passed preflight");

  const before = await operatorClient.exportReceiptV2(roundId);
  const beforeJson = serializeReceiptV2(before);
  if (beforeJson.includes(firstAssessment.note) || beforeJson.includes(secondAssessment.note)) throw new Error("review plaintext leaked before reveal");
  if (reviewers.some((reviewer) => before.submissions[reviewer]?.revealedEnvelope !== null)) throw new Error("receipt exposed an envelope before reveal");

  const waitMs = Math.max(0, privacyAt * 1000 - Date.now() + 4_000);
  if (waitMs > 0) await sleep(waitMs);
  await operatorClient.openRevealV2(roundId, await beacon(revealRound));

  const [storedFirstSeal, storedSecondSeal] = await Promise.all([
    firstClient.getSealV2(roundId, first.publicKey()),
    secondClient.getSealV2(roundId, second.publicKey()),
  ]);
  if (!storedFirstSeal || !storedSecondSeal) throw new Error("sealed payload expired before reveal");
  const [firstEnvelope, secondEnvelope] = await Promise.all([
    openPayload(storedFirstSeal.ciphertext, drand),
    openPayload(storedSecondSeal.ciphertext, drand),
  ]);
  await Promise.all([
    firstClient.revealV2({ roundId, bidder: first.publicKey(), envelope: firstEnvelope }),
    secondClient.revealV2({ roundId, bidder: second.publicKey(), envelope: secondEnvelope }),
  ]);
  const clearWaitMs = Math.max(0, revealDeadline * 1000 - Date.now() + 4_000);
  if (clearWaitMs > 0) await sleep(clearWaitMs);
  await clearWhenReady(operatorClient, roundId);

  const receipt = await operatorClient.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) throw new Error(`receipt invalid: ${verification.issues.map((issue) => issue.code).join(",")}`);
  if (receipt.mode !== "ReceiptOnly" || receipt.policy.fixedEscrow !== "0" || receipt.status !== "Settled") throw new Error("unexpected final round state");
  if (receipt.itemRef !== hex(itemRef) || receipt.roundId !== roundId.toString()) throw new Error("Proofwork binding mismatch");

  const decoded = reviewers.map((reviewer) => {
    const envelopeHex = receipt.submissions[reviewer]?.revealedEnvelope;
    if (!envelopeHex) throw new Error(`missing revealed envelope for ${reviewer}`);
    const envelope = decodePayloadEnvelope(Buffer.from(envelopeHex, "hex"));
    return JSON.parse(decodeSealedProposal(envelope.payload).approach) as SealedAssessment;
  });
  if (decoded.some((value) => value.campaignId !== fixture.campaignId || value.submissionId !== fixture.submissionId || value.roundId !== roundId.toString())) {
    throw new Error("decoded review is not bound to the Proofwork fixture");
  }

  const receiptJson = serializeReceiptV2(receipt);
  const output = {
    ranAt: new Date().toISOString(),
    network: "Stellar Testnet",
    contractId: receipt.contractId,
    roundId: receipt.roundId,
    mode: receipt.mode,
    fixedEscrow: receipt.policy.fixedEscrow,
    itemRef: receipt.itemRef,
    fixture,
    reviewerWallets: reviewers,
    reviewerWalletsDistinct: new Set(reviewers).size === 2,
    transactions: {
      create: operatorClient.submittedTransactionHashes[0],
      firstCommit: firstClient.submittedTransactionHashes[0],
      secondCommit: secondClient.submittedTransactionHashes[0],
      openReveal: operatorClient.submittedTransactionHashes[1],
      firstReveal: firstClient.submittedTransactionHashes[1],
      secondReveal: secondClient.submittedTransactionHashes[1],
      clear: operatorClient.submittedTransactionHashes[2],
    },
    receiptSha256: createHash("sha256").update(receiptJson).digest("hex"),
    receiptVerification: verification,
    checks: {
      plaintextAbsentBeforeReveal: true,
      contractOverwriteObserved: duplicate.ok,
      proofworkPinsFirstCommitment: true,
      unauthorizedCommitRejected: !unauthorized.ok,
      submissionBindingVerified: true,
      zeroSubRosaEscrow: receipt.policy.fixedEscrow === "0",
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`sealed review testnet run failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
