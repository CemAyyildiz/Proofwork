import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Data model per architecture §5. There is deliberately no `is_planted`
 * column anywhere: the plant list never enters this database (AD-10).
 */

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "decided",
  "appealed",
  "paid",
  "rejected",
]);

export const decisionOutcome = pgEnum("decision_outcome", ["PASS", "FAIL"]);

export const reasonCode = pgEnum("reason_code", [
  "R00_PASS",
  "R01_ACCOUNT",
  "R02_ORIGINAL",
  "R03_TASK",
  "R04_BRIEF",
  "R05_MULTI",
  "R06_SPAM",
]);

export const payoutStatus = pgEnum("payout_status", [
  "milestone_added",
  "delivered",
  "approved",
  "released",
  "failed",
]);

export const escrowOpKind = pgEnum("escrow_op_kind", [
  "deploy",
  "fund",
  "append_milestones",
  "mark_delivered",
  "approve",
  "release",
  "dispute",
  "resolve",
  "withdraw_remaining",
]);

export const escrowOpStatus = pgEnum("escrow_op_status", ["intent", "submitted", "confirmed", "failed"]);

export const roleName = pgEnum("role_name", ["funder", "reviewer", "ops"]);

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const campaigns = pgTable("campaign", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  rewardAmount: numeric("reward_amount", { precision: 18, scale: 7 }).notNull(),
  budget: numeric("budget", { precision: 18, scale: 7 }).notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  funderPubkey: text("funder_pubkey").notNull(),
  disputeResolverPubkey: text("dispute_resolver_pubkey").notNull(),
  escrowContractId: text("escrow_contract_id").unique(),
  fundedAt: timestamp("funded_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  remainderTxHash: text("remainder_tx_hash"),
  createdAt: createdAt(),
});

export const submissions = pgTable(
  "submission",
  {
    id: id(),
    shortId: text("short_id").notNull().unique(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    contributorPubkey: text("contributor_pubkey").notNull(),
    workUrl: text("work_url").notNull(),
    status: submissionStatus("status").notNull().default("pending"),
    submittedAt: createdAt(),
  },
  (t) => [
    index("submission_campaign_idx").on(t.campaignId),
    uniqueIndex("submission_campaign_contributor_idx").on(t.campaignId, t.contributorPubkey),
    uniqueIndex("submission_work_url_idx").on(t.workUrl),
  ],
);

export const decisions = pgTable(
  "decision",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    reviewerPubkey: text("reviewer_pubkey").notNull(),
    outcome: decisionOutcome("outcome").notNull(),
    reasonCode: reasonCode("reason_code").notNull(),
    /** six booleans keyed by rubric signal id; see domain/rubric.ts */
    signals: jsonb("signals").$type<Record<string, boolean>>().notNull(),
    note: text("note").notNull(),
    appealOf: text("appeal_of"),
    canonicalJson: text("canonical_json").notNull(),
    decisionHash: text("decision_hash").notNull(),
    ledgerKey: text("ledger_key").notNull(),
    txHash: text("tx_hash"),
    decidedAt: createdAt(),
  },
  (t) => [index("decision_submission_idx").on(t.submissionId)],
);

export const payouts = pgTable(
  "payout",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id)
      .unique(),
    milestoneIndex: integer("milestone_index"),
    amount: numeric("amount", { precision: 18, scale: 7 }).notNull(),
    status: payoutStatus("status").notNull(),
    releaseTxHash: text("release_tx_hash"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("payout_status_idx").on(t.status)],
);

export const escrowOps = pgTable(
  "escrow_op",
  {
    id: id(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    kind: escrowOpKind("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: escrowOpStatus("status").notNull().default("intent"),
    txHash: text("tx_hash"),
    error: text("error"),
    at: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("escrow_op_campaign_idx").on(t.campaignId), index("escrow_op_status_idx").on(t.status)],
);

export const authNonces = pgTable("auth_nonce", {
  nonce: text("nonce").primaryKey(),
  pubkey: text("pubkey").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const roleGrants = pgTable(
  "role_grant",
  {
    pubkey: text("pubkey").notNull(),
    role: roleName("role").notNull(),
    /** null = global grant */
    campaignId: text("campaign_id").references(() => campaigns.id),
    grantedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("role_grant_unique_idx").on(t.pubkey, t.role, sql`coalesce(${t.campaignId}, '')`),
  ],
);

export const reviewTimes = pgTable("review_time", {
  decisionId: text("decision_id")
    .primaryKey()
    .references(() => decisions.id),
  secondsTotal: integer("seconds_total").notNull(),
  secondsPerSignal: jsonb("seconds_per_signal").$type<Record<string, number>>().notNull(),
  blind: boolean("blind").notNull().default(true),
});

export type Campaign = typeof campaigns.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type EscrowOp = typeof escrowOps.$inferSelect;
