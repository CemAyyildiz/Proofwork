import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CopyLink } from "@/components/copy-link";
import { EscrowActions } from "@/components/escrow-actions";
import { EscrowBalance, EscrowBalanceLoading } from "@/components/escrow-balance";
import { FundingReadinessPanel } from "@/components/funding-readiness";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { dateLine, describeStep, OWNER_LABEL, StagePill } from "@/components/workspace/campaign-phase";
import { ClosePanel } from "@/components/workspace/close-panel";
import { ActivityLog, confirmedTx, Lifecycle, lifecycleNodes } from "@/components/workspace/lifecycle";
import { SubmissionsBoard, type BoardRow } from "@/components/workspace/submissions-board";
import { funderLimits } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import type { Campaign, EscrowOp } from "@/db/schema";
import { campaignStage, closeBlockers, countSubmissions, deadlinePassed, nextStep, type NextStep } from "@/domain/campaign-status";
import { currentUser } from "@/lib/current-user";
import { formatDateShort, formatRelative, formatUsdc } from "@/lib/format";
import { canManageCampaign } from "@/services/access";
import { fundingReadiness, fundSubmitted, getCampaignBySlug, horizonFunderAccountReader, limitRefusal } from "@/services/campaign";
import { listOps } from "@/services/escrow-ops";
import { submissionsForFunder } from "@/services/payout";

export const dynamic = "force-dynamic";

/** The page waits this long for Horizon before it shows the wallet as not checked. */
const READINESS_TIMEOUT_MS = 4_000;

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCampaignBySlug(slug);
  if (!c) notFound();
  const user = await currentUser(c.id);
  if (!user || !canManageCampaign(c, user)) notFound();
  const now = new Date();
  const ops = await listOps(c.id);
  const subs = await submissionsForFunder(c.id);
  const rows: BoardRow[] = subs.map((r) => ({
    submissionId: r.submission.id,
    shortId: r.submission.shortId,
    workUrl: r.submission.workUrl,
    contributor: r.submission.contributorPubkey,
    submitted: `${formatDateShort(r.submission.submittedAt)} · ${formatRelative(r.submission.submittedAt, now)}`,
    status: r.submission.status,
    outcome: r.latest?.outcome ?? null,
    reasonCode: r.latest?.reasonCode ?? null,
    note: r.latest?.note ?? null,
    decisionId: r.latest?.id ?? null,
    payoutStatus: r.payout?.status ?? null,
    releaseTxHash: r.payout?.releaseTxHash ?? null,
    milestoneIndex: r.payout?.milestoneIndex ?? null,
  }));
  const counts = countSubmissions(subs.map((r) => ({ status: r.submission.status, payoutStatus: r.payout?.status ?? null, payoutAmount: r.payout?.amount ?? null })));
  const stage = campaignStage(c, counts, now);
  const step = nextStep(stage, c, counts, now);
  const expired = step.kind === "expired";

  // The escrow controls' own stage names, unchanged from before the stages above.
  const escrowStage = c.closedAt ? "closed" : c.fundedAt ? "funded" : c.escrowContractId ? "deployed" : "draft";
  // A fund already sent may have landed, and then the budget has left the wallet: the button stays on so the escrow can be read.
  const fundSent = escrowStage === "deployed" && (await fundSubmitted(c.id));
  // Deploy and fund are offered before the budget is in escrow, and not for a campaign whose deadline passed, unless a fund was already sent.
  const offerStep = !expired || fundSent;
  // Only then is the wallet read: a funded, closed or expired campaign never reads it, and nothing there depends on it.
  const walletStep = !offerStep ? null : escrowStage === "draft" ? "deploy" : escrowStage === "deployed" ? "fund" : null;
  const readiness = walletStep ? await fundingReadiness(user.pubkey, c.budget, walletStep, horizonFunderAccountReader(READINESS_TIMEOUT_MS)) : null;
  // A draft that does not fit under the funder's limits is refused at deploy; say so here, before the click.
  const overLimit = walletStep === "deploy" ? ((await limitRefusal(user.pubkey, c.budget, funderLimits()))?.message ?? null) : null;
  const canAbandon = escrowStage === "deployed" && !fundSent;
  const open = stage === "open" || stage === "reviewing_and_paying" || stage === "ready_to_close";

  return (
    <div className="space-y-8">
      <Link href="/campaigns" className="inline-flex min-h-9 items-center text-[13px] font-medium text-muted hover:text-text">
        <span aria-hidden="true">←</span>&nbsp;Campaigns
      </Link>

      <header className="space-y-3">
        <StagePill stage={stage} />
        <h1 className="text-[clamp(28px,3.2vw,40px)] font-semibold leading-[1.05] tracking-[-0.04em] [overflow-wrap:anywhere]">{c.title}</h1>
        <p className="font-mono text-[12.5px] text-muted">{dateLine(c, stage, now)}</p>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
          <span>Signed in with</span>
          <HashChip value={user.pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(user.pubkey)} />
        </p>
      </header>

      <NextStepStrip campaign={c} step={step} viewer={user.pubkey} reviewer={user.roles.has("reviewer")} />

      <Lifecycle nodes={lifecycleNodes(c, stage, ops, now)} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <Section title="Escrow">
            <Card className="space-y-4 p-5">
              {c.escrowContractId ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-text-2">
                    <span>Contract</span>
                    <HashChip value={c.escrowContractId} href={publicEnv.explorerContractUrl(c.escrowContractId)} />
                  </p>
                  {c.fundedAt ? (
                    <Suspense fallback={<EscrowBalanceLoading />}>
                      <EscrowBalance slug={c.slug} contractId={c.escrowContractId} />
                    </Suspense>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">Not deployed yet.</p>
              )}
              {expired && !c.closedAt ? (
                <p className="max-w-[640px] text-sm text-text-2">
                  Deadline passed {formatDateShort(c.deadlineAt)}. This campaign can take no submissions, so deploy and fund are not offered
                  {canAbandon ? "; you can abandon it instead" : ""}.
                </p>
              ) : null}
              {overLimit ? (
                <p role="alert" className="max-w-[640px] text-sm text-fail">
                  This campaign can&apos;t be deployed while a limit is reached: {overLimit}. Deploy stays off until it fits.
                </p>
              ) : null}
              {walletStep && readiness ? <FundingReadinessPanel address={user.pubkey} step={walletStep} readiness={readiness} fundSent={fundSent} /> : null}
              {(escrowStage === "draft" || escrowStage === "deployed") && (offerStep || canAbandon) ? (
                <EscrowActions
                  campaignId={c.id}
                  funderPubkey={c.funderPubkey}
                  stage={escrowStage}
                  offerStep={offerStep}
                  blocked={overLimit !== null || (readiness !== null && readiness.status !== "ready" && !fundSent)}
                  canAbandon={canAbandon}
                />
              ) : null}
            </Card>
          </Section>

          {c.fundedAt ? (
            <Section
              title="Submissions and payouts"
              aside={
                rows.some((r) => r.decisionId) ? (
                  <a className="text-[13px] font-medium text-text-2 hover:text-text hover:underline" href={`/api/campaigns/${encodeURIComponent(c.id)}/review-log`}>
                    Download review log
                  </a>
                ) : null
              }
            >
              <SubmissionsBoard campaignId={c.id} funderPubkey={c.funderPubkey} rows={rows} counts={counts} closed={c.closedAt !== null} />
            </Section>
          ) : null}

          {/* A funded campaign must always be closable: the panel renders without submissions too. */}
          {open ? (
            <ClosePanel
              campaignId={c.id}
              funderPubkey={c.funderPubkey}
              blockers={closeBlockers(stage, c, counts, now)}
              unpaidPasses={counts.readyToPay}
              ended={deadlinePassed(c, now)}
              reviewer={user.roles.has("reviewer")}
            />
          ) : null}

          {stage === "closed_awaiting_return" || stage === "settled" ? <MoneyStory campaign={c} ops={ops} rows={rows} paidAmount={counts.paidAmount} /> : null}

          <Section title="On-chain activity">
            <ActivityLog ops={ops} />
          </Section>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card className="p-5">
            <Eyebrow>Details</Eyebrow>
            <dl className="mt-4 space-y-3.5 text-sm">
              <Fact label="Reward">{formatUsdc(c.rewardAmount)} per pass</Fact>
              <Fact label="Budget">{formatUsdc(c.budget)}</Fact>
              <Fact label="Created">{formatDateShort(c.createdAt)}</Fact>
              <Fact label="Deadline">{formatDateShort(c.deadlineAt)}</Fact>
              {c.closedAt ? <Fact label="Closed">{formatDateShort(c.closedAt)}</Fact> : null}
              <Fact label="Funder">
                <HashChip value={c.funderPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(c.funderPubkey)} />
              </Fact>
              <Fact label="Dispute resolver">
                <HashChip value={c.disputeResolverPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(c.disputeResolverPubkey)} />
              </Fact>
            </dl>
          </Card>

          <Card className="p-5">
            <Eyebrow>Contributor link</Eyebrow>
            <div className="mt-3">
              <CopyLink path={`/c/${c.slug}`} />
            </div>
            <p className="mt-2 text-[12.5px] text-muted">Share after funding. Submissions open only while the escrow holds the budget.</p>
          </Card>

          <Card className="p-5">
            <Eyebrow>Brief</Eyebrow>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-text-2 [overflow-wrap:anywhere]">{c.brief}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/** The one next step, whose it is and, for a wallet's step, which wallet. Same words as the list row. */
function NextStepStrip({ campaign: c, step, viewer, reviewer }: { campaign: Campaign; step: NextStep; viewer: string; reviewer: boolean }) {
  const { title, body } = describeStep(step, c);
  const wallet = step.owner === "funder" ? c.funderPubkey : step.owner === "resolver" ? c.disputeResolverPubkey : null;
  return (
    <section aria-label="Next step" className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[680px]">
          <Eyebrow>Next step</Eyebrow>
          <p className="mt-2 text-lg font-semibold tracking-[-0.02em]">{title}</p>
          <p className="mt-1 text-sm leading-normal text-text-2">{body}</p>
        </div>
        {step.owner ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
            <span>
              Waits on <span className="font-semibold text-text">{OWNER_LABEL[step.owner]}</span>
              {wallet === viewer ? " (you)" : ""}
            </span>
            {wallet ? <HashChip value={wallet} head={4} tail={4} href={publicEnv.explorerAccountUrl(wallet)} /> : null}
          </div>
        ) : null}
      </div>
      {step.kind === "review" && reviewer ? (
        <Link href="/review" className="mt-3 inline-flex min-h-9 items-center text-[13px] font-medium text-text hover:underline">
          Open the review queue →
        </Link>
      ) : null}
    </section>
  );
}

/** Closed and settled campaigns: what went in, what was paid and what came back, each with its transaction. */
function MoneyStory({ campaign: c, ops, rows, paidAmount }: { campaign: Campaign; ops: readonly EscrowOp[]; rows: BoardRow[]; paidAmount: string }) {
  const fundTx = confirmedTx(ops, "fund");
  const releases = rows.filter((r): r is BoardRow & { releaseTxHash: string } => r.releaseTxHash !== null);
  return (
    <Card className="p-5">
      <Eyebrow>Money</Eyebrow>
      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 text-sm">
        <MoneyRow label="Funded" amount={formatUsdc(c.budget)}>
          {fundTx ? <HashChip value={fundTx} href={publicEnv.explorerTxUrl(fundTx)} /> : <span className="text-muted">No fund tx recorded</span>}
        </MoneyRow>
        <MoneyRow label="Paid" amount={`${formatUsdc(paidAmount)} in ${releases.length} ${releases.length === 1 ? "payout" : "payouts"}`}>
          {releases.length === 0 ? <span className="text-muted">None</span> : releases.map((r) => <HashChip key={r.submissionId} value={r.releaseTxHash} href={publicEnv.explorerTxUrl(r.releaseTxHash)} />)}
        </MoneyRow>
        <MoneyRow label="Returned" amount={c.remainderTxHash ? "Remainder to the funder" : "Awaiting the resolver"}>
          {c.remainderTxHash ? (
            <HashChip value={c.remainderTxHash} href={publicEnv.explorerTxUrl(c.remainderTxHash)} />
          ) : (
            <HashChip value={c.disputeResolverPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(c.disputeResolverPubkey)} />
          )}
        </MoneyRow>
      </dl>
    </Card>
  );
}

function MoneyRow({ label, amount, children }: { label: string; amount: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 space-y-2">
        <p className="font-medium">{amount}</p>
        <div className="flex flex-wrap gap-2">{children}</div>
      </dd>
    </div>
  );
}
