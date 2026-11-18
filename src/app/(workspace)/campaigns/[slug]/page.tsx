import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CopyLink } from "@/components/copy-link";
import { EscrowActions } from "@/components/escrow-actions";
import { EscrowBalance, EscrowBalanceLoading } from "@/components/escrow-balance";
import { FundingReadinessPanel, type LimitItem } from "@/components/funding-readiness";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { dateLine, describeStep, OWNER_LABEL, StagePill } from "@/components/workspace/campaign-phase";
import { leftOf, slotParts } from "@/components/workspace/campaign-list";
import { ClosePanel } from "@/components/workspace/close-panel";
import { LimitMeter } from "@/components/workspace/limit-meter";
import { ax, figure, figureAxes, isZero, Label, Pieces, RiseWords, SlotLegend, SlotMeter } from "@/components/workspace/kit";
import { ActivityLog, confirmedTx, Lifecycle, lifecycleNodes } from "@/components/workspace/lifecycle";
import { CountUp } from "@/components/workspace/motion-bits";
import { BoardSelection, SelectForStep, SubmissionsBoard, type BoardRow } from "@/components/workspace/submissions-board";
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
  const refusal = walletStep === "deploy" ? await limitRefusal(user.pubkey, c.budget, funderLimits()) : null;
  const overLimit = refusal ? { message: refusal.message, caps: capsOf(refusal.details) } : null;
  const canAbandon = escrowStage === "deployed" && !fundSent;
  const open = stage === "open" || stage === "reviewing_and_paying" || stage === "ready_to_close";

  const meter = slotParts(c, counts);
  const toPay = counts.readyToPay + counts.awaitingSignature;

  return (
    <div className="space-y-10">
      <Link href="/campaigns" className="inline-flex min-h-9 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-text">
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
          <p className="font-mono text-[12px] text-white/60">
            <Pieces text={dateLine(c, stage, now)} />
          </p>
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

      {/* The Next step panel can filter and tick the board below it, so both share one selection. */}
      <BoardSelection rows={rows} closed={c.closedAt !== null}>
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
                <p className="text-sm text-white/60">Not deployed yet.</p>
              )}
              {expired && !c.closedAt && !fundSent ? (
                <p className="max-w-[640px] text-sm text-white/65">
                  Deadline passed {formatDateShort(c.deadlineAt)}. This campaign can take no submissions, so deploy and fund are not offered
                  {canAbandon ? "; you can abandon it instead" : ""}.
                </p>
              ) : null}
              {/* One checklist: the limits the draft breaks, then what the wallet lacks. */}
              {walletStep && readiness ? (
                <FundingReadinessPanel
                  address={user.pubkey}
                  step={walletStep}
                  readiness={readiness}
                  fundSent={fundSent}
                  limits={overLimit ? limitItems(overLimit.message, overLimit.caps, c.budget) : []}
                />
              ) : overLimit ? (
                <section aria-label="Limits" className="max-w-[680px] space-y-4 rounded-[22px] bg-white/[0.03] p-4 sm:p-5">
                  {limitItems(overLimit.message, overLimit.caps, c.budget).map((it) => (
                    <div key={it.key}>{it.body}</div>
                  ))}
                </section>
              ) : null}
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
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/60">Share after funding. Submissions open only while the escrow holds the budget.</p>
          </div>

          <div data-surface="paper" className="rounded-[28px] bg-paper p-6 text-paper-ink">
            <Label className="text-black/60">Brief</Label>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{c.brief}</p>
          </div>
        </aside>
      </div>
      </BoardSelection>
    </div>
  );
}

interface Cap {
  cap: "open_campaigns" | "open_budget";
  limit: string;
  used: string;
}

/** The refused caps from a limit refusal's details, as the service wrote them; anything else is dropped. */
function capsOf(details: Record<string, unknown> | undefined): Cap[] {
  const list = details?.caps;
  if (!Array.isArray(list)) return [];
  return list.flatMap((x: unknown): Cap[] => {
    if (typeof x !== "object" || x === null) return [];
    const { cap, limit, used } = x as Record<string, unknown>;
    if ((cap !== "open_campaigns" && cap !== "open_budget") || typeof limit !== "string" || typeof used !== "string") return [];
    return [{ cap, limit, used }];
  });
}

/**
 * A draft that does not fit under the funder's limits, as checklist items:
 * one per limit it breaks, said in the service's own words, each with a meter
 * that runs past the cap. Amounts go to the meter as decimal strings.
 */
function limitItems(message: string, caps: Cap[], budget: string): LimitItem[] {
  const parts = message.split("; ");
  const said = (prefix: string) => parts.find((p) => p.startsWith(prefix)) ?? (parts.length === 1 ? message : null);
  const sentence = (part: string | null) =>
    part ? <p className="text-white/75">{`This campaign can't be deployed while a limit is reached: ${part}. Deploy stays off until it fits.`}</p> : null;
  const items = caps.map((k): LimitItem =>
    k.cap === "open_campaigns"
      ? {
          key: k.cap,
          title: `Open campaigns: ${k.used} of ${k.limit} in use`,
          body: (
            <div className="space-y-3">
              {sentence(said("open-campaign"))}
              <dl>
                <LimitMeter label="Open campaigns" value={`${k.used} of ${k.limit} in use`} used={Number(k.used)} max={Number(k.limit)} adding={1} over note={parts.length > 1 ? "Close one first." : undefined} />
              </dl>
            </div>
          ),
        }
      : {
          key: k.cap,
          title: `Open budget: no room for ${formatUsdc(budget)}`,
          body: (
            <div className="space-y-3">
              {sentence(said("open-budget"))}
              <dl>
                <LimitMeter
                  label="Open budget"
                  value={`${formatUsdc(k.used)} of ${formatUsdc(k.limit)} in use, plus ${formatUsdc(budget)} here`}
                  used={k.used}
                  max={k.limit}
                  adding={budget}
                  over
                />
              </dl>
            </div>
          ),
        },
  );
  // A refusal whose details carry no caps is still said, as one item.
  return items.length > 0 ? items : [{ key: "limit", title: "A funder limit is reached", body: sentence(message) }];
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
      <dt className="text-white/60">{label}</dt>
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
  const hero = figure(funded ? (c.closedAt ? counts.paidAmount : leftOf(c.budget, counts.paidAmount)) : c.budget);
  const small = "block font-display text-[clamp(2.5rem,4.6vw,3.75rem)] leading-[0.82]";
  return (
    <section aria-label="Money" className="rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-5 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
        <div className="min-w-0">
          <Label>{funded ? (c.closedAt ? "Paid out" : "Left of budget") : "Budget"}</Label>
          <p className="mt-3">
            <span className={cx("block font-display text-[clamp(4rem,9.5vw,7.5rem)] leading-[0.8]", isZero(hero) && "text-white/60")} style={{ fontVariationSettings: figureAxes(hero) }}>
              <CountUp value={hero} />
            </span>
            <span className="mt-2 block text-[13px] text-white/60">
              {funded ? (c.closedAt ? "USDC released to contributors" : `USDC of ${figure(c.budget)} not yet paid out`) : "USDC, not in escrow yet"}
            </span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:gap-x-14">
          <div className="min-w-0">
            <Label>Ready to pay</Label>
            <p className="mt-3">
              <span className={cx(small, toPay > 0 ? "text-text" : "text-white/60")} style={{ fontVariationSettings: figureAxes(String(toPay), 64, 900) }}>
                <CountUp value={String(toPay)} />
              </span>
              <span className="mt-2 block text-[13px] text-white/60">{`${counts.readyToPay} to approve · ${counts.awaitingSignature} to release`}</span>
            </p>
          </div>
          <div className="min-w-0">
            <Label>Reward</Label>
            <p className="mt-3">
              <span className={small} style={{ fontVariationSettings: figureAxes(figure(c.rewardAmount), 64, 900) }}>
                {figure(c.rewardAmount)}
              </span>
              <span className="mt-2 block text-[13px] text-white/60">USDC for every approved post</span>
            </p>
          </div>
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
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">{`${meter.total} rewards once the budget is in escrow`}</p>
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
          {/* The panel's one control for a payout step: it filters the board and ticks those rows, so the bar under it is live. */}
          {yours && c.fundedAt && !c.closedAt && (step.kind === "approve" || step.kind === "release") ? (
            <div className="mt-5">
              <SelectForStep kind={step.kind} />
            </div>
          ) : null}
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
    <section aria-label="Money" data-surface="yellow" className="rounded-[30px] bg-accent p-6 text-accent-ink md:p-9">
      <Label className="text-black/60">Money</Label>
      <p className="mt-2 font-display text-[clamp(2.6rem,6vw,4.75rem)] leading-[0.86]" style={{ fontVariationSettings: ax(110, 900) }}>
        {c.remainderTxHash ? "Settled." : "Closed."}
      </p>
      <dl className="mt-8 border-t-2 border-black">
        <MoneyRow label="Funded" amount={formatUsdc(c.budget)}>
          {fundTx ? <TxLink hash={fundTx} /> : <span className="text-black/65">No fund tx recorded</span>}
        </MoneyRow>
        <MoneyRow label="Paid" amount={`${formatUsdc(paidAmount)} in ${releases.length} ${releases.length === 1 ? "payout" : "payouts"}`}>
          {releases.length === 0 ? <span className="text-black/65">None</span> : releases.map((r) => <TxLink key={r.submissionId} hash={r.releaseTxHash} />)}
        </MoneyRow>
        <MoneyRow label="Returned" amount={c.remainderTxHash ? "Remainder to the funder" : "Awaiting the resolver"}>
          {c.remainderTxHash ? (
            <TxLink hash={c.remainderTxHash} />
          ) : (
            <span data-surface="dark" className="rounded-full bg-black/90 [&>span]:border-0 [&>span]:bg-transparent [&>span]:text-white">
              <HashChip value={c.disputeResolverPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(c.disputeResolverPubkey)} />
            </span>
          )}
        </MoneyRow>
      </dl>
    </section>
  );
}

/** A transaction on yellow: a black chip, as in the public payouts list. Marked as a dark surface, so its focus ring is yellow against the black chip (globals.css). */
function TxLink({ hash }: { hash: string }) {
  return (
    <span data-surface="dark" className="inline-flex rounded-full bg-[#000] [&>span]:border-0 [&>span]:bg-transparent [&>span]:text-white [&>span:hover]:text-accent">
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
