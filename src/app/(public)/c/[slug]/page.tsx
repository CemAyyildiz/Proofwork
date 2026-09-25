import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppealButton } from "@/components/appeal-button";
import { stageOf, timelineView, type Stage } from "@/components/contributor-state";
import { Countdown } from "@/components/countdown";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill, type PillTone } from "@/components/ui/pill";
import { WalletButton } from "@/components/wallet-button";
import { WalletOnboarding } from "@/components/wallet-onboarding";
import { publicEnv } from "@/config/public-env";
import type { Decision } from "@/db/schema";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
import { getEscrow } from "@/escrow";
import { currentUser } from "@/lib/current-user";
import { budgetMeter, formatDateShort, formatUsdc, truncateMiddle } from "@/lib/format";
import { log } from "@/lib/logger";
import { mySubmission, publicCampaign, type MySubmission, type PublicCampaign } from "@/services/submission";

export const dynamic = "force-dynamic";

/** Freighter's own site; the Wallets Kit modal links it too when the extension is missing. */
const FREIGHTER_URL = "https://www.freighter.app";

const STAGE_PILL: Record<Stage, { tone: PillTone; label: string }> = {
  open: { tone: "pass", label: "Open" },
  closed: { tone: "wait", label: "Closed" },
  ended: { tone: "wait", label: "Deadline passed" },
  unfunded: { tone: "wait", label: "Not funded yet" },
};

/** "95 USDC" → "95": the unit is set small beside the figure. */
function figure(amount: string): string {
  return formatUsdc(amount).replace(/ USDC$/, "");
}

/** Staggered rise-in on load; CSS only, final state under reduced motion. */
function rise(i: number): { className: string; style: React.CSSProperties } {
  return { className: "animate-reveal", style: { animationDelay: `${i * 80}ms` } };
}

/** Contributor-facing campaign page: brief, live escrow balance, submit, own status. */
export default async function ContributorCampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await publicCampaign(slug);
  if (!c) notFound();

  let balance: string | null = null;
  if (c.escrowContractId) {
    try {
      balance = (await getEscrow().getEscrow(c.escrowContractId)).balance;
    } catch (e) {
      log.warn("escrow balance read failed", { slug, err: e instanceof Error ? e.message : String(e) });
    }
  }

  const user = await currentUser();
  const mine = user ? await mySubmission(c.id, user.pubkey) : null;
  const stage = stageOf(c);
  const pill = STAGE_PILL[stage];

  return (
    <div className="mx-auto max-w-[1180px] pb-24 pt-4 md:pt-6">
      <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-12">
        <div>
          <div style={rise(0).style} className={cx("flex flex-wrap items-center gap-2.5", rise(0).className)}>
            <Pill tone={pill.tone}>{pill.label}</Pill>
            <Eyebrow as="span">Bounty campaign</Eyebrow>
          </div>
          <h1
            style={rise(1).style}
            className={cx(
              "mt-5 text-[clamp(40px,5.4vw,76px)] font-semibold leading-[0.96] tracking-[-0.05em] [overflow-wrap:anywhere]",
              rise(1).className,
            )}
          >
            {c.title}
          </h1>
          <dl style={rise(2).style} className={cx("mt-7 flex flex-wrap gap-x-7 gap-y-4", rise(2).className)}>
            <Meta label="Reward">
              <span className="text-accent">{formatUsdc(c.rewardAmount)}</span>
            </Meta>
            {stage === "open" ? (
              <Meta label="Closes in">
                <Countdown deadlineAt={c.deadlineAt.toISOString()} fallback={formatDateShort(c.deadlineAt)} />
              </Meta>
            ) : stage === "unfunded" ? (
              <Meta label="Opens when funded">
                <span className="text-text-2">closes {formatDateShort(c.deadlineAt)}</span>
              </Meta>
            ) : stage === "ended" ? (
              <Meta label="Ended">{formatDateShort(c.deadlineAt)}</Meta>
            ) : (
              <Meta label="Closed">{formatDateShort(c.closedAt ?? c.deadlineAt)}</Meta>
            )}
            <Meta label="Reviewed by">a person</Meta>
          </dl>
          {stage === "open" ? (
            <p style={rise(2).style} className={cx("mt-3 text-[13px] text-muted", rise(2).className)}>
              Per approved submission, net of the 0.3% protocol fee. Closes {formatDateShort(c.deadlineAt)}.
            </p>
          ) : null}
        </div>
        <div style={rise(3).style} className={rise(3).className}>
          <EscrowCard contractId={c.escrowContractId} balance={balance} budget={c.budget} />
        </div>
      </div>

      <div className="mt-12 grid items-start gap-10 lg:mt-[72px] lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1" aria-label="Your submission">
          <Card style={rise(4).style} className={cx("p-6", rise(4).className)}>
            <SubmissionPanel c={c} stage={stage} signedIn={user !== null} pubkey={user?.pubkey ?? null} mine={mine} />
          </Card>
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <section>
            <Eyebrow>The task</Eyebrow>
            <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.04em]">What to do</h2>
            <p className="mt-4 max-w-[620px] whitespace-pre-wrap text-lg leading-[1.65] text-text-2 [overflow-wrap:anywhere]">{c.brief}</p>
          </section>
          <section className="mt-14">
            <Eyebrow>How you&apos;re reviewed</Eyebrow>
            <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.04em]">Six yes/no signals</h2>
            <ol className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {SIGNALS.map((s, i) => (
                <li key={s.id} className="rounded-lg border border-dashed border-line-strong px-[18px] py-4 text-[15px]">
                  <span className="block font-mono text-[11px] font-medium tracking-[0.1em] text-muted">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </li>
              ))}
            </ol>
            <p className="mt-3.5 text-sm text-muted">
              <b className="font-medium text-text-2">
                {PASS_THRESHOLD} of {SIGNALS.length} passes.
              </b>{" "}
              A person makes the call, the decision and its reason are written to Stellar, and you can request one re-review if
              you disagree. The funder gives final approval.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-1.5 text-[26px] font-semibold tracking-[-0.03em]">{children}</dd>
    </div>
  );
}

function EscrowCard({ contractId, balance, budget }: { contractId: string | null; balance: string | null; budget: string }) {
  const meter = budgetMeter(balance, budget);

  return (
    <Card glow className="overflow-hidden bg-linear-180 from-raised to-surface p-6 md:p-[26px]">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow as="span">Escrow balance</Eyebrow>
        {balance !== null ? (
          <span className="inline-flex items-center gap-2 font-mono text-xs font-medium text-pass">
            <span aria-hidden="true" className="h-[7px] w-[7px] animate-ping rounded-full bg-current" />
            Live from Stellar
          </span>
        ) : null}
      </div>

      {!contractId ? (
        <>
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.04em] text-text-2">Not funded yet</p>
          <p className="mt-3 text-sm text-muted">The funder has not deployed the escrow for this campaign.</p>
        </>
      ) : balance === null ? (
        <p className="mt-4 text-lg font-semibold text-fail">Balance unavailable, check on-chain</p>
      ) : (
        <>
          <p className="mt-3.5 text-[64px] font-semibold leading-none tracking-[-0.05em] md:text-[84px]">
            {figure(balance)}
            <small className="ml-[0.25em] text-[0.36em] font-medium tracking-[-0.01em] text-muted">USDC held</small>
          </p>
          {meter ? (
            <>
              <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(meter.pct)}
                aria-valuetext={meter.label}
                aria-label="Budget left in escrow"
                className="mt-5 h-2 overflow-hidden rounded-[4px] bg-white/5"
              >
                <div className="h-full origin-left animate-grow rounded-[4px] bg-accent" style={{ width: `${meter.pct}%` }} />
              </div>
              <p className="mt-2.5 text-[12.5px] text-muted">
                {meter.label}
              </p>
            </>
          ) : null}
        </>
      )}

      <p className="mt-5 flex items-start gap-3 border-t border-line pt-[18px] text-[13.5px] leading-normal text-text-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" className="mt-0.5 shrink-0 stroke-accent" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Proofwork can&apos;t move this money. Only the funder releases payouts; only a neutral resolver can return what&apos;s left.
      </p>
      {contractId ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-muted">Escrow contract</span>
          <HashChip value={contractId} href={publicEnv.explorerAccountUrl(contractId)} />
        </div>
      ) : null}
    </Card>
  );
}

function SubmissionPanel({
  c,
  stage,
  signedIn,
  pubkey,
  mine,
}: {
  c: PublicCampaign;
  stage: Stage;
  signedIn: boolean;
  pubkey: string | null;
  mine: MySubmission | null;
}) {
  if (mine) {
    return (
      <>
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Your submission</h2>
        <Timeline mine={mine} campaignOpen={c.open} />
      </>
    );
  }
  if (stage !== "open") {
    return (
      <>
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Submissions</h2>
        <p className="mt-3 text-sm text-text-2">
          {stage === "closed"
            ? "This campaign is closed."
            : stage === "ended"
              ? "The deadline has passed. This campaign no longer accepts submissions."
              : "Submissions open once the budget is in escrow."}
        </p>
      </>
    );
  }
  if (!signedIn || !pubkey) {
    return (
      <>
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Submit your post</h2>
        <p className="mt-3 text-sm leading-normal text-text-2">
          Connect your Stellar wallet to submit. The reward is paid to that wallet in USDC. If the wallet is new, this page
          activates it on testnet and adds USDC before you submit.
        </p>
        <WalletButton pubkey={null} className="mt-4" />
        <p className="mt-3 text-[12.5px] text-muted">
          No wallet yet?{" "}
          <a href={FREIGHTER_URL} target="_blank" rel="noreferrer" className="rounded-sm font-medium text-accent hover:underline">
            Install Freighter ↗
          </a>
        </p>
      </>
    );
  }
  return (
    <>
      <h2 className="text-lg font-semibold tracking-[-0.02em]">Submit your post</h2>
      <WalletOnboarding key={pubkey} campaignSlug={c.slug} address={pubkey} />
    </>
  );
}

type NodeState = "done" | "fail" | "current" | "pending";

function Step({ state, last = false, children }: { state: NodeState; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[32px_1fr] gap-3.5 pb-[26px] last:pb-0">
      {!last ? (
        <span
          aria-hidden="true"
          className={cx(
            "absolute bottom-1 left-[15px] top-[34px] w-0.5 rounded-[1px]",
            state === "done" ? "bg-linear-180 from-pass to-pass-line" : "bg-line-strong",
          )}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={cx(
          "grid h-8 w-8 place-items-center rounded-full border-2",
          state === "done" && "animate-pop border-pass bg-pass",
          state === "fail" && "animate-pop border-fail bg-fail",
          state === "current" && "border-accent bg-canvas shadow-[0_0_0_5px_var(--color-accent-soft)]",
          state === "pending" && "border-white/20 bg-canvas",
        )}
      >
        {state === "done" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-ink">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : state === "fail" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-accent-ink">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        ) : state === "current" ? (
          <span className="h-2 w-2 animate-blink rounded-full bg-accent" />
        ) : null}
      </span>
      <div className="min-w-0 pt-[5px]">{children}</div>
    </li>
  );
}

function StepTitle({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <p className={cx("text-[15.5px] font-semibold", muted && "text-muted")}>{children}</p>;
}

function StepText({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[13.5px] leading-normal text-muted">{children}</p>;
}

function passCount(d: Decision): number {
  return SIGNALS.filter((s) => d.signals[s.id] === true).length;
}

function Timeline({ mine, campaignOpen }: { mine: MySubmission; campaignOpen: boolean }) {
  const s = mine.submission;
  const { recorded, unrecorded, reReviewPending, canAppeal, paid } = timelineView(mine, campaignOpen);
  const latest = recorded.at(-1) ?? null;
  const shownUrl = s.workUrl.replace(/^https:\/\//, "");

  return (
    <ol className="mt-5">
      <Step state="done">
        <StepTitle>Submitted</StepTitle>
        <StepText>
          <a href={s.workUrl} target="_blank" rel="noreferrer" title={s.workUrl} className="font-mono text-[12.5px] text-text-2 hover:text-text">
            {truncateMiddle(shownUrl, 24, 6)} ↗
          </a>
          <span className="block">{formatDateShort(s.submittedAt)}</span>
        </StepText>
      </Step>

      {recorded.map((d, i) => {
        const isLast = d === latest;
        const pass = d.outcome === "PASS";
        return (
          <Step key={d.id} state={pass ? "done" : "fail"}>
            <StepTitle>
              {i > 0 || d.appealOf ? "Re-review" : "Reviewed"} · <span className={pass ? "text-pass" : "text-fail"}>{d.outcome}</span>
            </StepTitle>
            <StepText>
              {passCount(d)} / {SIGNALS.length} · <span className="font-mono">{d.reasonCode}</span>
            </StepText>
            {d.note ? (
              <blockquote className="mt-2.5 rounded-md border border-line bg-sunken px-3.5 py-3 text-sm leading-normal text-text-2 [overflow-wrap:anywhere]">
                {d.note}
              </blockquote>
            ) : null}
            <Link href={`/verify/${d.id}`} className="mt-2.5 inline-flex rounded-sm text-[13.5px] font-medium text-accent hover:underline">
              Verify decision on-chain →
            </Link>
            {isLast && !pass && canAppeal ? <AppealButton submissionId={s.id} /> : null}
          </Step>
        );
      })}

      {unrecorded ? (
        <Step state="current">
          <StepTitle>Recording on Stellar</StepTitle>
          <StepText>The decision is being written to Stellar. It shows here once the transaction confirms.</StepText>
        </Step>
      ) : reReviewPending ? (
        <Step state="current">
          <StepTitle>Re-review requested</StepTitle>
          <StepText>A person will look again. The new decision is also written to Stellar.</StepText>
        </Step>
      ) : recorded.length === 0 ? (
        <Step state="current">
          <StepTitle>In review</StepTitle>
          <StepText>Waiting for review. Every post is read by a person.</StepText>
        </Step>
      ) : null}

      {paid ? (
        <Step state="done" last>
          <StepTitle>
            Paid · <span className="text-pass">{formatUsdc(paid.amount)}</span>
          </StepTitle>
          <StepText>Released from escrow to your wallet.</StepText>
          <HashChip value={paid.releaseTxHash} href={publicEnv.explorerTxUrl(paid.releaseTxHash)} className="mt-2.5" />
        </Step>
      ) : (
        <Step state="pending" last>
          <StepTitle muted>Paid</StepTitle>
          <StepText>
            {latest?.outcome === "FAIL" && !reReviewPending
              ? "Only after a pass."
              : latest?.outcome === "PASS"
                ? "Released from escrow to your wallet once the funder signs."
                : "Released from escrow to your wallet if it passes."}
          </StepText>
        </Step>
      )}
    </ol>
  );
}
