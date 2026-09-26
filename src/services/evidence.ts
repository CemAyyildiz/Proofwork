import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { campaigns, decisions, escrowOps, payouts, submissions, type Campaign, type EscrowOp } from "@/db/schema";
import { publicEnv } from "@/config/public-env";
import { AppError } from "@/lib/errors";
import { formatUsdc, truncateMiddle } from "@/lib/format";
import { idempotencyKey } from "@/lib/ids";
import { approveKeyParts, deliverKeyParts } from "./op-keys";

/**
 * Evidence dump for one campaign (SOW §6.1): every confirmed on-chain escrow
 * op and every decision record, as Markdown with stellar.expert links.
 * Run by `scripts/evidence-dump.ts`, so this module does not import
 * "server-only". It never reads work URLs or anything planted-related, and
 * contributor wallets are truncated.
 */

export const NO_HASH = "confirmed on chain, hash not recorded";

/** Order the sections appear in, which is also the order they happen in. */
const SECTIONS: Array<{ kind: EscrowOp["kind"]; title: string; signer: string }> = [
  { kind: "deploy", title: "Deploy escrow", signer: "funder wallet" },
  { kind: "fund", title: "Fund budget", signer: "funder wallet" },
  { kind: "append_milestones", title: "Append reward milestones", signer: "platform admin key" },
  { kind: "mark_delivered", title: "Mark delivered", signer: "platform ops key" },
  { kind: "approve", title: "Approve milestone", signer: "platform ops key" },
  { kind: "release", title: "Release reward (per contributor)", signer: "funder wallet" },
  { kind: "dispute", title: "Dispute close milestone (campaign close)", signer: "funder wallet" },
  { kind: "resolve", title: "Resolve dispute", signer: "dispute resolver key" },
  { kind: "withdraw_remaining", title: "Withdraw remainder to funder", signer: "dispute resolver key" },
];

export interface EvidenceRow {
  /** Tx hash; "" when the op was reconciled from chain without its hash. */
  txHash: string;
  detail: string;
  /** When the app last wrote the row; null when unknown. */
  at: Date | null;
}

export interface EvidenceDecision {
  decisionId: string;
  shortId: string;
  ledgerKey: string;
  round: "first" | "re-review";
  outcome: string;
  reasonCode: string;
  decisionHash: string;
  txHash: string | null;
  decidedAt: Date;
}

export interface CampaignEvidence {
  campaign: Pick<Campaign, "slug" | "title" | "escrowContractId" | "budget" | "rewardAmount" | "fundedAt" | "closedAt">;
  ops: Map<EscrowOp["kind"], EvidenceRow[]>;
  /** Ops that never confirmed: counted, not listed. */
  unconfirmed: { failedOrIntent: number; submitted: number };
  decisions: EvidenceDecision[];
}

function milestoneOf(op: EscrowOp): number | null {
  const v = (op.payload as { milestoneIndex?: unknown }).milestoneIndex;
  return typeof v === "number" ? v : null;
}

function contributor(shortId: string, pubkey: string): string {
  return `${shortId} · ${truncateMiddle(pubkey, 4, 4)}`;
}

export async function loadCampaignEvidence(conn: Db, slug: string): Promise<CampaignEvidence> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.slug, slug)).limit(1))[0];
  if (!c) throw AppError.notFound(`campaign "${slug}"`);

  const subs = await conn
    .select({ id: submissions.id, shortId: submissions.shortId, contributorPubkey: submissions.contributorPubkey })
    .from(submissions)
    .where(eq(submissions.campaignId, c.id));
  const subById = new Map(subs.map((s) => [s.id, s]));

  // Deliver and approve ops are keyed per submission; the key is a hash, so rebuild it to find the owner.
  const byKey = new Map<string, string>();
  for (const s of subs) {
    byKey.set(idempotencyKey(deliverKeyParts(c.id, s.id)), contributor(s.shortId, s.contributorPubkey));
    byKey.set(idempotencyKey(approveKeyParts(c.id, s.id)), contributor(s.shortId, s.contributorPubkey));
  }

  const pays = await conn
    .select({ p: payouts, s: submissions })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(eq(submissions.campaignId, c.id));
  const payByMilestone = new Map<number, (typeof pays)[number]>();
  for (const r of pays) if (r.p.milestoneIndex !== null) payByMilestone.set(r.p.milestoneIndex, r);

  const allOps = await conn.select().from(escrowOps).where(eq(escrowOps.campaignId, c.id)).orderBy(asc(escrowOps.updatedAt), asc(escrowOps.id));
  const ops = new Map<EscrowOp["kind"], EvidenceRow[]>();
  const push = (kind: EscrowOp["kind"], row: EvidenceRow) => ops.set(kind, [...(ops.get(kind) ?? []), row]);
  const unconfirmed = { failedOrIntent: 0, submitted: 0 };

  for (const op of allOps) {
    if (op.status !== "confirmed") {
      if (op.status === "submitted") unconfirmed.submitted++;
      else unconfirmed.failedOrIntent++;
      continue;
    }
    const txHash = op.txHash ?? "";
    let detail = "";
    switch (op.kind) {
      case "deploy":
        detail = c.escrowContractId ? `contract ${c.escrowContractId}` : "";
        break;
      case "fund":
        detail = formatUsdc(c.budget);
        break;
      case "mark_delivered":
      case "approve":
        detail = byKey.get(op.idempotencyKey) ?? "";
        break;
      case "release": {
        const idx = milestoneOf(op);
        const pay = idx === null ? undefined : payByMilestone.get(idx);
        detail = pay
          ? `${contributor(pay.s.shortId, pay.s.contributorPubkey)} · ${formatUsdc(pay.p.amount)} · milestone ${idx}`
          : idx === null
            ? ""
            : `milestone ${idx}`;
        break;
      }
      case "dispute":
        detail = "milestone 0 (campaign close)";
        break;
      default:
        break;
    }
    push(op.kind, { txHash, detail, at: op.updatedAt });
  }

  // The remainder sweep runs outside the app (`pnpm escrow:close`) and lands on the campaign row.
  // Only when no op row exists, so a recovered op without its hash is not listed twice.
  if (c.remainderTxHash && !ops.has("withdraw_remaining")) {
    push("withdraw_remaining", { txHash: c.remainderTxHash, detail: "remaining balance → funder", at: c.closedAt });
  }

  const decs = await conn
    .select({ d: decisions })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .where(eq(submissions.campaignId, c.id))
    .orderBy(asc(decisions.decidedAt), asc(decisions.id));

  return {
    campaign: {
      slug: c.slug,
      title: c.title,
      escrowContractId: c.escrowContractId,
      budget: c.budget,
      rewardAmount: c.rewardAmount,
      fundedAt: c.fundedAt,
      closedAt: c.closedAt,
    },
    ops,
    unconfirmed,
    decisions: decs.map(({ d }) => ({
      decisionId: d.id,
      shortId: subById.get(d.submissionId)?.shortId ?? "?",
      ledgerKey: d.ledgerKey,
      round: d.appealOf ? "re-review" : "first",
      outcome: d.outcome,
      reasonCode: d.reasonCode,
      decisionHash: d.decisionHash,
      txHash: d.txHash,
      decidedAt: d.decidedAt,
    })),
  };
}

function txCell(hash: string): string {
  if (hash === "") return NO_HASH;
  return `[${truncateMiddle(hash, 12, 0)}](${publicEnv.explorerTxUrl(hash)})`;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
/** Makes any value safe inside a Markdown table cell or heading: one line, no table or link syntax. */
export function cell(s: string): string {
  return s
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/[\\`*_[\]|<>]/g, (ch) => `\\${ch}`);
}

export function renderCampaignEvidence(e: CampaignEvidence, opts: { siteUrl: string; generatedAt: Date }): string {
  const c = e.campaign;
  const out: string[] = [];
  out.push(`# Campaign evidence: ${cell(c.title)}`, "");
  out.push(
    `Generated ${iso(opts.generatedAt)} by \`pnpm evidence:dump ${c.slug}\`. Network: Stellar testnet. This page lists what the app recorded; it makes no chain read. Each hash links to stellar.expert, where the transaction can be checked on chain.`,
    "",
  );
  out.push("| | |", "|---|---|");
  out.push(`| Campaign | \`${c.slug}\` |`);
  out.push(
    `| Escrow contract | ${c.escrowContractId ? `[\`${c.escrowContractId}\`](${publicEnv.explorerAccountUrl(c.escrowContractId)})` : "not deployed"} |`,
  );
  out.push(`| Budget | ${formatUsdc(c.budget)} |`);
  out.push(`| Reward per approved submission | ${formatUsdc(c.rewardAmount)} |`);
  out.push(`| Funded | ${c.fundedAt ? iso(c.fundedAt) : "no"} |`);
  out.push(`| Closed | ${c.closedAt ? iso(c.closedAt) : "no"} |`);
  out.push("");
  out.push(
    `Contributors appear as submission short ID and truncated wallet. "${NO_HASH}" marks an op whose effect was confirmed by reading the escrow after a submit error, so its hash was never returned to the app; the escrow state itself is the proof.`,
    "",
  );

  out.push("## Escrow transactions", "");
  for (const s of SECTIONS) {
    const rows = e.ops.get(s.kind) ?? [];
    if (rows.length === 0 && s.kind === "resolve") continue; // not part of the close path (AD-4)
    out.push(`### ${s.title}`, "", `Signed by: ${s.signer}.`, "");
    if (rows.length === 0) {
      out.push("None recorded.", "");
      continue;
    }
    out.push("| # | Tx | Detail | Recorded (UTC) |", "|---|---|---|---|");
    rows.forEach((r, i) => out.push(`| ${i + 1} | ${txCell(r.txHash)} | ${cell(r.detail)} | ${r.at ? iso(r.at) : ""} |`));
    out.push("");
  }
  if (e.unconfirmed.failedOrIntent > 0) {
    out.push(`${e.unconfirmed.failedOrIntent} op(s) prepared or failed without a confirmed effect on chain; not listed.`, "");
  }
  if (e.unconfirmed.submitted > 0) {
    out.push(`${e.unconfirmed.submitted} op(s) submitted but not yet confirmed; they may still land. Run the dump again once they settle.`, "");
  }

  out.push("## Decision records", "");
  out.push(
    "One classic Stellar transaction per decision from the decision ledger account: `manage_data` under the ledger key, value `v1|<outcome>|<reason>|<first 16 hex of the hash>`, and `memo_hash` = SHA-256 of the canonical decision JSON. The verify page recomputes that hash in the browser.",
    "",
  );
  if (e.decisions.length === 0) {
    out.push("None recorded.", "");
  } else {
    const onChain = e.decisions.filter((d) => d.txHash).length;
    out.push(`${e.decisions.length} decisions, ${onChain} committed on chain.`, "");
    out.push("| Submission | Ledger key | Round | Outcome | Reason code | Record hash | Tx | Verify |", "|---|---|---|---|---|---|---|---|");
    for (const d of e.decisions) {
      const tx = d.txHash ? txCell(d.txHash) : "not committed";
      const verify = `[verify](${opts.siteUrl.replace(/\/+$/, "")}/verify/${d.decisionId})`;
      out.push(
        `| ${cell(d.shortId)} | ${cell(d.ledgerKey)} | ${d.round} | ${d.outcome} | ${d.reasonCode} | \`${truncateMiddle(d.decisionHash, 16, 0)}\` | ${tx} | ${verify} |`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}
