import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import type { Campaign, EscrowOp } from "@/db/schema";
import { deadlinePassed, type CampaignStage } from "@/domain/campaign-status";
import { formatDateShort, formatRelative, formatTimestamp, shortKey } from "@/lib/format";

export interface LifecycleNode {
  label: string;
  done: boolean;
  /** One line under the label: a date, or who the step waits on. */
  detail: string | null;
  txHash: string | null;
}

/** The tx hash of the kind's confirmed op, if any. */
export const confirmedTx = (ops: readonly EscrowOp[], kind: EscrowOp["kind"]) => ops.find((o) => o.kind === kind && o.status === "confirmed")?.txHash ?? null;

/** The campaign's life on chain, left to right. A node is done only from chain-confirmed columns and confirmed ops. */
export function lifecycleNodes(c: Campaign, stage: CampaignStage, ops: readonly EscrowOp[], now: Date): LifecycleNode[] {
  const created: LifecycleNode = { label: "Created", done: true, detail: formatDateShort(c.createdAt), txHash: null };
  const deployed: LifecycleNode = { label: "Escrow deployed", done: c.escrowContractId !== null, detail: null, txHash: confirmedTx(ops, "deploy") };
  const closedDetail = c.closedAt ? formatDateShort(c.closedAt) : null;
  if (stage === "abandoned") return [created, deployed, { label: "Abandoned", done: true, detail: closedDetail, txHash: null }];

  // Submissions are shut at the deadline, or earlier when the campaign was closed first.
  const shut = deadlinePassed(c, now) || c.closedAt !== null;
  return [
    created,
    deployed,
    { label: "Funded", done: c.fundedAt !== null, detail: c.fundedAt ? formatDateShort(c.fundedAt) : null, txHash: confirmedTx(ops, "fund") },
    {
      label: shut ? "Submissions closed" : "Submissions close",
      done: c.fundedAt !== null && shut,
      detail: `${formatDateShort(c.deadlineAt)} · ${formatRelative(c.deadlineAt, now)}`,
      txHash: null,
    },
    { label: "Closed", done: c.closedAt !== null, detail: closedDetail, txHash: confirmedTx(ops, "dispute") },
    {
      label: "Remainder returned",
      done: c.remainderTxHash !== null,
      detail: `by the resolver ${shortKey(c.disputeResolverPubkey)}`,
      txHash: c.remainderTxHash,
    },
  ];
}

export function Lifecycle({ nodes }: { nodes: LifecycleNode[] }) {
  const current = nodes.findIndex((n) => !n.done);
  return (
    <ol
      className={cx(
        "grid grid-cols-[minmax(0,1fr)] gap-x-2 gap-y-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-3",
        nodes.length > 3 ? "lg:grid-cols-6" : "lg:grid-cols-3",
      )}
      aria-label="Campaign lifecycle"
    >
      {nodes.map((n, i) => {
        const state = n.done ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={n.label} className="flex min-w-0 gap-3 lg:flex-col lg:gap-2.5">
            <div className="flex items-center gap-2 lg:w-full">
              <span
                aria-hidden="true"
                className={cx(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                  state === "done" && "border-pass-line bg-pass-soft text-pass",
                  state === "current" && "border-accent bg-accent-soft text-accent shadow-[0_0_0_4px_var(--color-accent-soft)]",
                  state === "upcoming" && "border-line-strong text-muted",
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              {i < nodes.length - 1 ? <span aria-hidden="true" className={cx("hidden h-px flex-1 lg:block", n.done ? "bg-pass-line" : "bg-line-strong")} /> : null}
            </div>
            <div className="min-w-0">
              <p className={cx("text-[13.5px] font-semibold tracking-[-0.01em]", state === "upcoming" ? "text-muted" : "text-text")}>
                {n.label}
                <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : " (not yet)"}</span>
              </p>
              {n.detail ? <p className="mt-0.5 font-mono text-[11.5px] text-muted">{n.detail}</p> : null}
              {n.txHash ? <HashChip className="mt-1.5" value={n.txHash} head={4} tail={4} href={publicEnv.explorerTxUrl(n.txHash)} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const OP_LABEL: Record<EscrowOp["kind"], string> = {
  deploy: "Escrow deployed",
  fund: "Budget funded",
  append_milestones: "Payout milestones added",
  mark_delivered: "Payout marked delivered",
  approve: "Payout approved",
  release: "Payout released",
  dispute: "Campaign closed",
  resolve: "Dispute resolved",
  withdraw_remaining: "Remainder returned",
};

const OP_STATUS: Record<EscrowOp["status"], { label: string; className: string }> = {
  intent: { label: "Prepared", className: "text-muted" },
  submitted: { label: "Sent", className: "text-text-2" },
  confirmed: { label: "Confirmed", className: "text-pass" },
  failed: { label: "Failed", className: "text-fail" },
};

/** Every escrow transaction this campaign prepared, newest first. */
export function ActivityLog({ ops }: { ops: readonly EscrowOp[] }) {
  if (ops.length === 0) return <p className="text-sm text-muted">No on-chain activity yet.</p>;
  const rows = [...ops].reverse();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {rows.map((o) => {
        const s = OP_STATUS[o.status];
        return (
          <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <span className="min-w-0 font-medium sm:min-w-[180px]">{OP_LABEL[o.kind]}</span>
            <span className={cx("font-mono text-[12px]", s.className)}>{s.label}</span>
            <span className="font-mono text-[12px] text-muted">{formatTimestamp(o.updatedAt)}</span>
            <span className="min-w-0 sm:ml-auto">
              {o.txHash ? (
                <HashChip value={o.txHash} href={publicEnv.explorerTxUrl(o.txHash)} />
              ) : o.error ? (
                <span className="line-clamp-2 max-w-[420px] text-[12px] text-fail [overflow-wrap:anywhere]" title={o.error}>
                  {o.error}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
