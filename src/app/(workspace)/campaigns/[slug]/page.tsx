import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CopyLink } from "@/components/copy-link";
import { EscrowActions } from "@/components/escrow-actions";
import { EscrowBalance, EscrowBalanceLoading } from "@/components/escrow-balance";
import { FundingReadinessPanel } from "@/components/funding-readiness";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { dateLine, describeStep, OWNER_LABEL, StagePill } from "@/components/workspace/campaign-phase";
import { leftOf, slotParts } from "@/components/workspace/campaign-list";
import { ClosePanel } from "@/components/workspace/close-panel";
import { ax, figure, Label, RiseWords, SlotLegend, SlotMeter } from "@/components/workspace/kit";
import { ActivityLog, confirmedTx, Lifecycle, lifecycleNodes } from "@/components/workspace/lifecycle";
import { CountUp } from "@/components/workspace/motion-bits";
import { SubmissionsBoard, type BoardRow } from "@/components/workspace/submissions-board";
import { funderLimits } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import type { Campaign, EscrowOp } from "@/db/schema";
import { campaignStage, closeBlockers, countSubmissions, deadlinePassed, nextStep, type NextStep, type SubmissionCounts } from "@/domain/campaign-status";
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

  const meter = slotParts(c, counts);
  const toPay = counts.readyToPay + counts.awaitingSignature;

  return (
    <div className="space-y-10">
      <Link href="/campaigns" className="inline-flex min-h-9 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-text">
        <span aria-hidden="true">←</span>&nbsp;Campaigns
      </Link>

      <header>
        <StagePill stage={stage} />
        <h1
          className="mt-5 max-w-[1000px] font-display text-[clamp(2.6rem,6vw,5.25rem)] leading-[0.9] [overflow-wrap:anywhere]"
          style={{ fontVariationSettings: ax(84, 850) }}
        >
          <RiseWords text={c.title} />
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="font-mono text-[12px] text-white/50">{dateLine(c, stage, now)}</p>
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-white/55">
            <span>Signed in with</span>
            <HashChip value={user.pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(user.pubkey)} />
          </p>
        </div>
      </header>

      <MoneyHero campaign={c} counts={counts} meter={meter} toPay={toPay}>
        {c.escrowContractId ? (
          <div className="flex flex-wrap items-center gap-2">
            {c.fundedAt ? <HashChip value={c.escrowContractId} href={publicEnv.explorerContractUrl(c.escrowContractId)} /> : null}
            <Suspense fallback={<EscrowBalanceLoading />}>
              <EscrowBalance slug={c.slug} contractId={c.escrowContractId} />
            </Suspense>
          </div>
        ) : null}
      </MoneyHero>

      <NextStepStrip campaign={c} step={step} viewer={user.pubkey} reviewer={user.roles.has("reviewer")} />

      <Lifecycle nodes={lifecycleNodes(c, stage, ops, now)} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-12">
          {/* Once funded, the contract and its balance sit with the money above and nothing here is left to do. */}
          {c.fundedAt ? null : (
          <Section title="Escrow">
            <div className="space-y-5 rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-5 md:p-7">
              {c.escrowContractId ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-white/60">
                  <span>Contract</span>
                  <HashChip value={c.escrowContractId} href={publicEnv.explorerContractUrl(c.escrowContractId)} />
                </p>
              ) : (
                <p className="text-sm text-white/50">Not deployed yet.</p>
              )}
              {expired && !c.closedAt && !fundSent ? (
                <p className="max-w-[640px] text-sm text-white/65">
                  Deadline passed {formatDateShort(c.deadlineAt)}. This campaign can take no submissions, so deploy and fund are not offered
                  {canAbandon ? "; you can abandon it instead" : ""}.
                </p>
              ) : null}
              {overLimit ? (
                <p role="alert" className="max-w-[640px] rounded-2xl border border-fail-line bg-fail-soft px-4 py-3 text-sm text-fail">
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
            </div>
          </Section>
          )}

          {c.fundedAt ? (
            <Section
              title="Submissions and payouts"
              aside={
                rows.some((r) => r.decisionId) ? (
                  <a
                    className="inline-flex min-h-9 items-center rounded-full border border-white/15 px-4 text-[13px] font-semibold text-white/75 transition-colors hover:border-white/40 hover:text-text"
                    href={`/api/campaigns/${encodeURIComponent(c.id)}/review-log`}
                  >
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

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-10 xl:self-start">
          <div className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6">
            <Label>Details</Label>
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
          </div>

          <div className="rounded-[28px] border border-white/[0.07] bg-[#0d0d0d] p-6">
            <Label>Contributor link</Label>
            <div className="mt-3">
              <CopyLink path={`/c/${c.slug}`} />
            </div>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/45">Share after funding. Submissions open only while the escrow holds the budget.</p>
          </div>

          <div className="rounded-[28px] bg-paper p-6 text-paper-ink">
            <Label className="text-black/50">Brief</Label>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{c.brief}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-[clamp(1.75rem,3vw,2.4rem)] leading-none" style={{ fontVariationSettings: ax(85, 830) }}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <dt className="text-white/45">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * The money at a glance: what is left of the budget, what is ready to pay and
 * what has been paid, over the escrow drawn as one slot per reward. Figures
 * come from the recorded payouts; the live chain balance sits under them.
 */
function MoneyHero({ campaign: c, counts, meter, toPay, children }: { campaign: Campaign; counts: SubmissionCounts; meter: ReturnType<typeof slotParts>; toPay: number; children: ReactNode }) {
  const funded = c.fundedAt !== null;
  const big = "block font-display text-[clamp(3.6rem,8vw,6.5rem)] leading-[0.8]";
  return (
    <section aria-label="Money" className="rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-5 md:p-8">
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 sm:gap-x-10">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <Label>{funded ? (c.closedAt ? "Paid out" : "Left of budget") : "Budget"}</Label>
          <p className="mt-3">
            <span className={big} style={{ fontVariationSettings: ax(62, 900) }}>
              <CountUp value={figure(funded ? (c.closedAt ? counts.paidAmount : leftOf(c.budget, counts.paidAmount)) : c.budget)} />
            </span>
            <span className="mt-2 block text-[13px] text-white/50">
              {funded ? (c.closedAt ? "USDC released to contributors" : `USDC of ${figure(c.budget)} not yet paid out`) : "USDC, not in escrow yet"}
            </span>
          </p>
        </div>
        <div className="min-w-0">
          <Label>Ready to pay</Label>
          <p className="mt-3">
            <span className={cx(big, toPay > 0 ? "text-accent" : "text-white/20")} style={{ fontVariationSettings: ax(62, 900) }}>
              <CountUp value={String(toPay)} />
            </span>
            <span className="mt-2 block text-[13px] text-white/50">{`${counts.readyToPay} to approve · ${counts.awaitingSignature} to release`}</span>
          </p>
        </div>
        <div className="min-w-0">
          <Label>Reward</Label>
          <p className="mt-3">
            <span className={big} style={{ fontVariationSettings: ax(62, 900) }}>
              {figure(c.rewardAmount)}
            </span>
            <span className="mt-2 block text-[13px] text-white/50">USDC for every approved post</span>
          </p>
        </div>
      </div>
      <div className="mt-9">
        {funded ? (
          <SlotMeter total={meter.total} parts={meter.parts} size="lg" />
        ) : (
          <div aria-hidden="true" className="flex gap-[3px]">
            {Array.from({ length: Math.min(meter.total, 48) }, (_, i) => (
              <span key={i} className="h-10 min-w-0 flex-1 rounded-md border border-dashed border-white/15 md:h-14" />
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {funded ? (
            <SlotLegend parts={meter.parts} />
          ) : (
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45">{`${meter.total} rewards once the budget is in escrow`}</p>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}

/** The one next step, whose it is and, for a wallet's step, which wallet. Same words as the list row. */
function NextStepStrip({ campaign: c, step, viewer, reviewer }: { campaign: Campaign; step: NextStep; viewer: string; reviewer: boolean }) {
  const { title, body } = describeStep(step, c);
  const wallet = step.owner === "funder" ? c.funderPubkey : step.owner === "resolver" ? c.disputeResolverPubkey : null;
  const yours = wallet === viewer;
  return (
    <section
      aria-label="Next step"
      className={cx(
        "relative overflow-hidden rounded-[28px] p-6 md:p-8",
        yours ? "border border-accent/50 bg-[linear-gradient(120deg,rgba(253,218,36,0.10),rgba(253,218,36,0.02)_45%,transparent)]" : "border border-white/[0.07] bg-[#0d0d0d]",
      )}
    >
      {yours ? <span aria-hidden="true" className="absolute inset-y-6 left-0 w-1 rounded-r-full bg-accent" /> : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 max-w-[720px]">
          <Label className={yours ? "text-accent" : undefined}>Next step</Label>
          <p className="mt-3 font-display text-[clamp(2rem,4vw,3.25rem)] leading-[0.92]" style={{ fontVariationSettings: ax(84, 850) }}>
            {title}
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-white/60">{body}</p>
        </div>
        {step.owner ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-white/60">
            <span>
              Waits on <span className="font-semibold text-text">{OWNER_LABEL[step.owner]}</span>
              {wallet === viewer ? " (you)" : ""}
            </span>
            {wallet ? <HashChip value={wallet} head={4} tail={4} href={publicEnv.explorerAccountUrl(wallet)} /> : null}
          </div>
        ) : null}
      </div>
      {step.kind === "review" && reviewer ? (
        <Link href="/review" className="mt-5 inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 text-[13px] font-semibold text-text transition-colors hover:border-white/40">
          Open the review queue →
        </Link>
      ) : null}
      {step.kind === "remainder" && c.disputeResolverPubkey === viewer ? (
        <Link href="/admin" className="mt-5 inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 text-[13px] font-semibold text-text transition-colors hover:border-white/40">
          Return the remainder from Admin →
        </Link>
      ) : null}
    </section>
  );
}

/** Closed and settled campaigns, in the yellow of money that moved: what went in, what was paid and what came back, each with its transaction. */
function MoneyStory({ campaign: c, ops, rows, paidAmount }: { campaign: Campaign; ops: readonly EscrowOp[]; rows: BoardRow[]; paidAmount: string }) {
  const fundTx = confirmedTx(ops, "fund");
  const releases = rows.filter((r): r is BoardRow & { releaseTxHash: string } => r.releaseTxHash !== null);
  return (
    <section aria-label="Money" className="rounded-[30px] bg-accent p-6 text-accent-ink md:p-9">
      <Label className="text-black/60">Money</Label>
      <p className="mt-2 font-display text-[clamp(2.6rem,6vw,4.75rem)] leading-[0.86]" style={{ fontVariationSettings: ax(110, 900) }}>
        {c.remainderTxHash ? "Settled." : "Closed."}
      </p>
      <dl className="mt-8 border-t-2 border-black">
        <MoneyRow label="Funded" amount={formatUsdc(c.budget)}>
          {fundTx ? <TxLink hash={fundTx} /> : <span className="text-black/55">No fund tx recorded</span>}
        </MoneyRow>
        <MoneyRow label="Paid" amount={`${formatUsdc(paidAmount)} in ${releases.length} ${releases.length === 1 ? "payout" : "payouts"}`}>
          {releases.length === 0 ? <span className="text-black/55">None</span> : releases.map((r) => <TxLink key={r.submissionId} hash={r.releaseTxHash} />)}
        </MoneyRow>
        <MoneyRow label="Returned" amount={c.remainderTxHash ? "Remainder to the funder" : "Awaiting the resolver"}>
          {c.remainderTxHash ? (
            <TxLink hash={c.remainderTxHash} />
          ) : (
            <span className="rounded-full bg-black/90 [&>span]:border-0 [&>span]:bg-transparent [&>span]:text-white">
              <HashChip value={c.disputeResolverPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(c.disputeResolverPubkey)} />
            </span>
          )}
        </MoneyRow>
      </dl>
    </section>
  );
}

/** A transaction on yellow: a black chip, as in the public payouts list. */
function TxLink({ hash }: { hash: string }) {
  return (
    <span className="inline-flex rounded-full bg-black [&>span]:border-0 [&>span]:bg-transparent [&>span]:text-white [&>span:hover]:text-accent">
      <HashChip value={hash} href={publicEnv.explorerTxUrl(hash)} />
    </span>
  );
}

function MoneyRow({ label, amount, children }: { label: string; amount: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-b border-black/20 py-5 sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/60 sm:pt-2">{label}</dt>
      <dd className="min-w-0 space-y-3">
        <p className="font-display text-[clamp(1.6rem,3vw,2.25rem)] leading-none" style={{ fontVariationSettings: ax(80, 850) }}>
          {amount}
        </p>
        <div className="flex flex-wrap gap-2">{children}</div>
      </dd>
    </div>
  );
}
