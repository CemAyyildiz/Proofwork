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

export const funderRequestStatus = pgEnum("funder_request_status", ["pending", "approved", "rejected"]);

export const accessAction = pgEnum("access_action", ["grant", "revoke"]);

export const accessVia = pgEnum("access_via", ["admin", "script"]);

export const sealedReviewStatus = pgEnum("sealed_review_status", [
  "draft",
  "open",
  "revealing",
  "cleared",
  "finalizing",
  "finalized",
  "expired",
  "failed",
]);

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
  /** New founder-sealed campaigns pin an external wallet as the on-chain release signer. Null keeps the legacy funder signer. */
  releaseSignerPubkey: text("release_signer_pubkey"),
  founderSealedReview: boolean("founder_sealed_review").notNull().default(false),
  disputeResolverPubkey: text("dispute_resolver_pubkey").notNull(),
  escrowContractId: text("escrow_contract_id").unique(),
  fundedAt: timestamp("funded_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  remainderTxHash: text("remainder_tx_hash"),
  /** Payout pipeline lease: the holder's token and when it lapses. Null when free. */
  payoutLockToken: text("payout_lock_token"),
  payoutLockUntil: timestamp("payout_lock_until", { withTimezone: true }),
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
    /**
     * Numeric ID of the submitted X post, from the link. Unique, so one post is
     * submitted once whatever handle or host its link carries. Null on rows
     * the backfill skipped (a post ID another earlier row shares, or one not
     * in the canonical spelling) and on rows the previous release stored
     * between the migration and its own replacement. Those are matched by the
     * ID at the end of `work_url` instead, see `alreadySubmitted`.
     */
    postId: text("post_id"),
    /**
     * Account that created the contributor's wallet, as Horizon reported it at
     * submission. Stored raw (Friendbot included) so the public-source list
     * applies at read time. Null = not looked up or no creation record.
     */
    fundingSource: text("funding_source"),
    status: submissionStatus("status").notNull().default("pending"),
    submittedAt: createdAt(),
  },
  (t) => [
    index("submission_campaign_idx").on(t.campaignId),
    uniqueIndex("submission_campaign_contributor_idx").on(t.campaignId, t.contributorPubkey),
    uniqueIndex("submission_work_url_idx").on(t.workUrl),
    uniqueIndex("submission_post_id_idx").on(t.postId),
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

/** Logout invalidates every session token issued before `revokedBefore` (tokens are stateless HMAC). */
export const sessionRevocations = pgTable("session_revocation", {
  pubkey: text("pubkey").primaryKey(),
  revokedBefore: timestamp("revoked_before", { withTimezone: true }).notNull(),
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

/**
 * A wallet's request for funder access, decided by the operator. The partial
 * unique index gives a wallet at most one pending request. A rejection is
 * recorded here and nowhere else: it changes no role.
 */
export const funderRequests = pgTable(
  "funder_request",
  {
    id: id(),
    pubkey: text("pubkey").notNull(),
    team: text("team").notNull(),
    note: text("note").notNull(),
    status: funderRequestStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
  },
  (t) => [
    uniqueIndex("funder_request_pending_idx").on(t.pubkey).where(sql`${t.status} = 'pending'`),
    index("funder_request_pubkey_idx").on(t.pubkey),
  ],
);

/**
 * History of role changes: one row per grant or revocation that changed
 * `role_grant`, written in the same transaction by `changeRole`
 * (services/access.ts). Append-only: no code updates or deletes a row.
 * `actor_pubkey` is the ops wallet that acted; null when `via` is "script".
 */
export const accessLog = pgTable(
  "access_log",
  {
    id: id(),
    pubkey: text("pubkey").notNull(),
    role: roleName("role").notNull(),
    action: accessAction("action").notNull(),
    actorPubkey: text("actor_pubkey"),
    via: accessVia("via").notNull(),
    /** scope of the changed grant; null = global */
    campaignId: text("campaign_id").references(() => campaigns.id),
    /** the approved request behind a grant, when there is one */
    requestId: text("request_id").references(() => funderRequests.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_log_at_idx").on(t.at)],
);

export const reviewTimes = pgTable("review_time", {
  decisionId: text("decision_id")
    .primaryKey()
    .references(() => decisions.id),
  secondsTotal: integer("seconds_total").notNull(),
  secondsPerSignal: jsonb("seconds_per_signal").$type<Record<string, number>>().notNull(),
  blind: boolean("blind").notNull().default(true),
  /**
   * Shared-funding count the review card showed, posted with the decision:
   * other submissions in the campaign linked by funding source. 0 = checked,
   * no link found. Null = source not checked, or decided before the warning existed.
   */
  sharedFundingCount: integer("shared_funding_count"),
});

/**
 * Experimental Sub Rosa round attached to one otherwise-normal submission.
 * No review plaintext is written here before a verified, cleared receipt.
 */
export const sealedReviews = pgTable(
  "sealed_review",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id)
      .unique(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    status: sealedReviewStatus("status").notNull().default("draft"),
    itemRef: text("item_ref").notNull(),
    schemaRef: text("schema_ref").notNull(),
    contractId: text("contract_id"),
    roundId: text("round_id"),
    revealRound: integer("reveal_round").notNull(),
    commitDeadline: timestamp("commit_deadline", { withTimezone: true }).notNull(),
    revealDeadline: timestamp("reveal_deadline", { withTimezone: true }).notNull(),
    auditorPubkey: text("auditor_pubkey").notNull(),
    operatorPubkey: text("operator_pubkey").notNull(),
    createTxHash: text("create_tx_hash"),
    clearTxHash: text("clear_tx_hash"),
    receiptJson: text("receipt_json"),
    receiptSha256: text("receipt_sha256"),
    receiptVerified: boolean("receipt_verified").notNull().default(false),
    finalDecisionId: text("final_decision_id").references(() => decisions.id),
    failureCode: text("failure_code"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("sealed_review_campaign_idx").on(t.campaignId),
    uniqueIndex("sealed_review_round_idx").on(t.contractId, t.roundId),
    uniqueIndex("sealed_review_create_tx_idx").on(t.createTxHash),
    uniqueIndex("sealed_review_clear_tx_idx").on(t.clearTxHash),
  ],
);

export const sealedReviewAssignments = pgTable(
  "sealed_review_assignment",
  {
    id: id(),
    sealedReviewId: text("sealed_review_id")
      .notNull()
      .references(() => sealedReviews.id),
    reviewerPubkey: text("reviewer_pubkey").notNull(),
    commitment: text("commitment"),
    commitTxHash: text("commit_tx_hash"),
    revealTxHash: text("reveal_tx_hash"),
    /** Populated only after the cleared receipt passes canonical verification. */
    revealedReview: jsonb("revealed_review").$type<Record<string, unknown>>(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sealed_review_assignment_unique_idx").on(t.sealedReviewId, t.reviewerPubkey),
    index("sealed_review_assignment_reviewer_idx").on(t.reviewerPubkey),
    uniqueIndex("sealed_review_assignment_commit_tx_idx").on(t.commitTxHash),
    uniqueIndex("sealed_review_assignment_reveal_tx_idx").on(t.revealTxHash),
  ],
);

/**
 * A wallet's connected X account. The primary key gives one X account per
 * wallet, the unique index one wallet per X account. The numeric account ID is
 * the only thing from X this database holds: no token, handle or name.
 */
export const xAccounts = pgTable("x_account", {
  pubkey: text("pubkey").primaryKey(),
  xUserId: text("x_user_id").notNull().unique(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type EscrowOp = typeof escrowOps.$inferSelect;
export type FunderRequest = typeof funderRequests.$inferSelect;
export type AccessLogEntry = typeof accessLog.$inferSelect;
export type SealedReview = typeof sealedReviews.$inferSelect;
export type SealedReviewAssignment = typeof sealedReviewAssignments.$inferSelect;
