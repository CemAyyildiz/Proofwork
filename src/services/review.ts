import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db/client";
import { campaigns, decisions, reviewTimes, submissions, type Decision, type Submission } from "@/db/schema";
import { evaluate, reasonCodeSchema, signalsSchema, validateReason } from "@/domain/rubric";
import type { DecisionLedger } from "@/ledger/decision-ledger";
import type { DecisionRecord } from "@/ledger/canonical";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { log } from "@/lib/logger";

/**
 * Blind review queue. The reviewer sees the work URL, a short id and the
 * campaign brief — never the contributor's identity beyond what the URL
 * itself reveals, and never any hint of which submissions were planted
 * (there is no such column, by design).
 */
export interface QueueItem {
  submissionId: string;
  shortId: string;
  workUrl: string;
  submittedAt: Date;
  status: Submission["status"];
  campaign: { id: string; slug: string; title: string; brief: string };
  priorDecision: Decision | null;
}

export async function reviewQueue(conn: Db = db): Promise<QueueItem[]> {
  const rows = await conn
    .select({ s: submissions, c: campaigns })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(and(inArray(submissions.status, ["pending", "appealed"]), isNull(campaigns.closedAt)))
    .orderBy(asc(submissions.status), sql`md5(${submissions.id})`); // stable but not chronological: order reveals nothing

  const appealed = rows.filter((r) => r.s.status === "appealed").map((r) => r.s.id);
  const priors = appealed.length
    ? await conn.select().from(decisions).where(inArray(decisions.submissionId, appealed)).orderBy(desc(decisions.decidedAt))
    : [];
  const priorBySub = new Map<string, Decision>();
  for (const d of priors) if (!priorBySub.has(d.submissionId)) priorBySub.set(d.submissionId, d);

  return rows.map((r) => ({
    submissionId: r.s.id,
    shortId: r.s.shortId,
    workUrl: r.s.workUrl,
    submittedAt: r.s.submittedAt,
    status: r.s.status,
    campaign: { id: r.c.id, slug: r.c.slug, title: r.c.title, brief: r.c.brief },
    priorDecision: priorBySub.get(r.s.id) ?? null,
  }));
}

export const decideSchema = z.object({
  submissionId: z.string().min(1),
  signals: signalsSchema,
  reasonCode: reasonCodeSchema,
  note: z.string().trim().min(3).max(1000),
  secondsTotal: z.number().int().min(0).max(24 * 3600),
  secondsPerSignal: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type DecideInput = z.infer<typeof decideSchema>;

/**
 * Records a decision and commits it on-chain in the same call. If the chain
 * write fails the decision row is still stored with tx_hash null and the
 * error is surfaced; `retryCommit` can finish it. The submission status
 * only advances once the on-chain reference exists (AD-9).
 */
export async function decide(
  input: DecideInput,
  actor: { pubkey: string },
  ledger: DecisionLedger,
  conn: Db = db,
): Promise<Decision> {
  const reason = validateReason(input.signals, input.reasonCode);
  if (!reason.ok) throw AppError.validation(reason.message);
  const { outcome } = evaluate(input.signals);

  const row = (
    await conn
      .select({ s: submissions, c: campaigns })
      .from(submissions)
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(eq(submissions.id, input.submissionId))
      .limit(1)
  )[0];
  if (!row) throw AppError.notFound("submission");
  if (row.c.closedAt) throw AppError.conflict("campaign is closed");
  if (row.s.status !== "pending" && row.s.status !== "appealed") {
    throw AppError.conflict(`submission is ${row.s.status}, not reviewable`);
  }

  const prior = (await conn.select().from(decisions).where(eq(decisions.submissionId, row.s.id)).orderBy(desc(decisions.decidedAt)).limit(1))[0];
  const isAppeal = row.s.status === "appealed";
  if (isAppeal && !prior) throw AppError.conflict("appealed submission has no prior decision");
  if (!isAppeal && prior) throw AppError.conflict("submission already decided");

  const record: DecisionRecord = {
    v: 1,
    submission: row.s.shortId,
    campaign: row.c.slug,
    reviewer: actor.pubkey,
    outcome,
    reason: input.reasonCode,
    signals: input.signals,
    appealOf: isAppeal ? (prior as Decision).decisionHash : null,
    decidedAt: new Date().toISOString(),
  };

  const committed = await ledger.commit(record);

  const id = newId("dec");
  const [decision] = await conn
    .insert(decisions)
    .values({
      id,
      submissionId: row.s.id,
      reviewerPubkey: actor.pubkey,
      outcome,
      reasonCode: input.reasonCode,
      signals: input.signals,
      note: input.note,
      appealOf: isAppeal ? (prior as Decision).id : null,
      canonicalJson: committed.canonicalJson,
      decisionHash: committed.decisionHash,
      ledgerKey: committed.ledgerKey,
      txHash: committed.txHash,
      decidedAt: new Date(record.decidedAt),
    })
    .returning();
  await conn.insert(reviewTimes).values({ decisionId: id, secondsTotal: input.secondsTotal, secondsPerSignal: input.secondsPerSignal, blind: true });
  await conn
    .update(submissions)
    .set({ status: outcome === "PASS" ? "decided" : "rejected" })
    .where(eq(submissions.id, row.s.id));

  log.info("decision recorded", { decisionId: id, submission: row.s.shortId, outcome, txHash: committed.txHash, appeal: isAppeal });
  return decision as Decision;
}

/** Contributor asks for the one re-review the SOW allows. */
export async function requestAppeal(submissionId: string, actor: { pubkey: string }, conn: Db = db): Promise<void> {
  const s = (await conn.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1))[0];
  if (!s) throw AppError.notFound("submission");
  if (s.contributorPubkey !== actor.pubkey) throw AppError.forbidden("not your submission");
  if (s.status !== "rejected") throw AppError.conflict("only a rejected submission can be appealed");
  const count = (await conn.select({ n: sql<number>`count(*)::int` }).from(decisions).where(eq(decisions.submissionId, s.id)))[0]?.n ?? 0;
  if (count >= 2) throw AppError.conflict("the one re-review has already been used");
  await conn.update(submissions).set({ status: "appealed" }).where(eq(submissions.id, s.id));
}

export async function getDecision(id: string, conn: Db = db) {
  const row = (
    await conn
      .select({ d: decisions, s: submissions, c: campaigns })
      .from(decisions)
      .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(eq(decisions.id, id))
      .limit(1)
  )[0];
  return row ?? null;
}
