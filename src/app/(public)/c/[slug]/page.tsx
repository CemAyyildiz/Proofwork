import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { AppealButton } from "@/components/appeal-button";
import { stageOf, timelineView, xNotice, type Stage, type XNotice } from "@/components/contributor-state";
import { Countdown } from "@/components/countdown";
import { EscrowCard } from "@/components/escrow-card";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill, type PillTone } from "@/components/ui/pill";
import { WalletButton } from "@/components/wallet-button";
import { WalletOnboarding } from "@/components/wallet-onboarding";
import { XConnectStep } from "@/components/x-connect";
import { campaignFor } from "./campaign";
import { xConfig } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import type { Decision } from "@/db/schema";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
import { xOutcomeSchema } from "@/domain/x-connect";
import { getEscrow } from "@/escrow";
import { currentUser } from "@/lib/current-user";
import { formatDateShort, formatUsdc, truncateMiddle } from "@/lib/format";
import { log } from "@/lib/logger";
import { campaignFacts } from "@/services/public-directory";
import { mySubmission, type MySubmission, type PublicCampaign } from "@/services/submission";
import { xAccountFor } from "@/services/x-account";

export const dynamic = "force-dynamic";

/** Freighter's own site; the Wallets Kit modal links it too when the extension is missing. */
const FREIGHTER_URL = "https://www.freighter.app";

/** Longest the page waits on the live escrow balance before rendering without it. */
const BALANCE_TIMEOUT_MS = 4_000;

const STAGE_PILL: Record<Stage, { tone: PillTone; label: string }> = {
  open: { tone: "pass", label: "Open" },
  closed: { tone: "wait", label: "Closed" },
  ended: { tone: "wait", label: "Deadline passed" },
  unfunded: { tone: "wait", label: "Not funded yet" },
};

/** Staggered rise-in on load; CSS only, final state under reduced motion. */
function rise(i: number): { className: string; style: React.CSSProperties } {
  return { className: "animate-reveal", style: { animationDelay: `${i * 80}ms` } };
}


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await campaignFor((await params).slug);
  if (!c) return { title: "Campaign not found" };
  const description = `${formatUsdc(c.rewardAmount)}${publicEnv.isMainnet ? "" : " (testnet)"} per approved post, reviewed by a person, paid from escrow on Stellar.`;
  return {
    title: c.title,
    description,
    openGraph: { title: c.title, description, type: "website" },
    twitter: { card: "summary_large_image", title: c.title, description },
  };
}

/** Contributor-facing campaign page: brief, live escrow balance, submit, own status. */
export default async function ContributorCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ x?: string | string[] }>;
}) {
  const { slug } = await params;
  const c = await campaignFor(slug);
  if (!c) notFound();

  const user = await currentUser();
  const mine = user ? await mySubmission(c.id, user.pubkey) : null;
  const stage = stageOf(c);
  const pill = STAGE_PILL[stage];

  // The X step belongs to the submit panel only: open campaign, nothing submitted yet.
  // It gates the form: the server accepts a post only from the connected account.
  const submitting = stage === "open" && !mine;
  const xConnected = submitting && user ? (await xAccountFor(user.pubkey)) !== null : false;
  const xAvailable = xConfig() !== null;
  const xOutcome = xOutcomeSchema.safeParse((await searchParams).x);
  const notice = submitting ? xNotice(xOutcome.success ? xOutcome.data : null, { signedIn: user !== null, connected: xConnected }) : null;

  const facts = await campaignFacts(c.id);

  return (
    <div className="mx-auto max-w-[1180px] pb-24 pt-2 md:pt-4">
      <Link href="/explore" className="inline-flex min-h-9 items-center gap-1.5 rounded-sm font-mono text-[12px] text-muted hover:text-text">
        <span aria-hidden="true">←</span> All bounties
      </Link>
      <header style={rise(0).style} className={cx("mt-3 border-b border-line pb-7", rise(0).className)}>
        <h1 className="max-w-[900px] text-[clamp(30px,3.6vw,46px)] font-semibold leading-[1.04] tracking-[-0.045em] [overflow-wrap:anywhere]">{c.title}</h1>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
          <Pill tone={pill.tone}>{pill.label}</Pill>
          {facts.team ? (
            <span>
              by <span className="font-medium text-text-2">{facts.team}</span>
            </span>
          ) : null}
          <span className="font-mono">
            {facts.submissions} {facts.submissions === 1 ? "submission" : "submissions"}
          </span>
          {facts.paid > 0 ? <span className="font-mono text-pass">{facts.paid} paid</span> : null}
          <span>Reviewed by a person</span>
        </p>
      </header>

      <div className="mt-8 grid items-start gap-x-12 gap-y-10 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside id="submit" className="scroll-mt-24 grid gap-4 lg:sticky lg:top-24" aria-label="Reward and your submission">
          <Card style={rise(1).style} className={cx("overflow-hidden", rise(1).className)}>
            <div className="border-b border-line p-6">
              <Eyebrow className="text-[11px]">Reward</Eyebrow>
              <p className="mt-2 flex items-baseline gap-2.5">
                <span className="font-mono text-[34px] font-medium leading-none tracking-[-0.04em] text-accent">{formatUsdc(c.rewardAmount)}</span>
                {publicEnv.isMainnet ? null : (
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted">testnet</span>
                )}
              </p>
              <p className="mt-2 text-[12.5px] leading-normal text-muted">
                Per approved submission, net of the 0.3% protocol fee.{" "}
                {publicEnv.isMainnet ? "Paid in USDC on Stellar mainnet." : "Testnet USDC, not real money."}
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
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
                <Meta label="Budget">{formatUsdc(c.budget)}</Meta>
              </dl>
            </div>
            <div className="p-6">
              <SubmissionPanel c={c} stage={stage} signedIn={user !== null} pubkey={user?.pubkey ?? null} mine={mine} xConnected={xConnected} xAvailable={xAvailable} xNote={notice} />
            </div>
          </Card>
          <div style={rise(2).style} className={rise(2).className}>
            {c.escrowContractId ? (
              <Suspense fallback={<EscrowCard contractId={c.escrowContractId} balance={null} loading budget={c.budget} closed={stage === "closed"} remainderTxHash={c.remainderTxHash} />}>
                <LiveEscrowCard slug={slug} contractId={c.escrowContractId} budget={c.budget} closed={stage === "closed"} remainderTxHash={c.remainderTxHash} />
              </Suspense>
            ) : (
              <EscrowCard contractId={null} balance={null} budget={c.budget} closed={stage === "closed"} remainderTxHash={c.remainderTxHash} />
            )}
          </div>
        </aside>

        <div style={rise(2).style} className={cx("min-w-0", rise(2).className)}>
          <section>
            <Eyebrow>The task</Eyebrow>
            <p className="mt-4 max-w-[680px] whitespace-pre-wrap text-[17px] leading-[1.7] text-text-2 [overflow-wrap:anywhere]">{c.brief}</p>
          </section>
          <section className="mt-12 border-t border-line pt-10">
            <Eyebrow>How you&apos;re reviewed</Eyebrow>
            <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.03em]">
              Six yes/no signals.{" "}
              <span className="text-muted">
                {PASS_THRESHOLD} of {SIGNALS.length} passes.
              </span>
            </h2>
            <ol className="mt-5 max-w-[680px] border-t border-line">
              {SIGNALS.map((s, i) => (
                <li key={s.id} className="grid grid-cols-[34px_1fr] items-baseline border-b border-line py-3.5 text-[15px]">
                  <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </li>
              ))}
            </ol>
            <p className="mt-4 max-w-[680px] text-sm leading-normal text-muted">
              A person makes the call, the decision and its reason are written to Stellar, and you can request one re-review if you
              disagree. The funder gives final approval.
            </p>
          </section>
        </div>
      </div>

      {stage === "open" && !mine ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 px-[18px] pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-[16px] lg:hidden">
          <a href="#submit" className={cx(buttonClasses("primary"), "w-full")}>
            Submit your post · {formatUsdc(c.rewardAmount)}
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** Streams in after the page: the balance is a live Trustless Work read, capped so it can't hang. */
async function LiveEscrowCard({
  slug,
  contractId,
  ...rest
}: {
  slug: string;
  contractId: string;
  budget: string;
  closed: boolean;
  remainderTxHash: string | null;
}) {
  let balance: string | null = null;
  try {
    const read = getEscrow().getEscrow(contractId);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("balance read timed out")), BALANCE_TIMEOUT_MS));
    balance = (await Promise.race([read, timeout])).balance;
  } catch (e) {
    log.warn("escrow balance read failed", { slug, err: e instanceof Error ? e.message : String(e) });
  }
  return <EscrowCard contractId={contractId} balance={balance} {...rest} />;
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1.5 font-mono text-[15px] font-medium tracking-[-0.01em]">{children}</dd>
    </div>
  );
}

function SubmissionPanel({
  c,
  stage,
  signedIn,
  pubkey,
  mine,
  xConnected,
  xAvailable,
  xNote,
}: {
  c: PublicCampaign;
  stage: Stage;
  signedIn: boolean;
  pubkey: string | null;
  mine: MySubmission | null;
  xConnected: boolean;
  /** False when the deployment has no X credentials: the step says submissions are not possible yet, and the form stays locked. */
  xAvailable: boolean;
  xNote: XNotice | null;
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
          Connect your Stellar wallet to submit. The reward is paid to that wallet in USDC. If the wallet is new, this page{" "}
          {publicEnv.isMainnet ? "shows how to open it and adds the USDC trustline" : "activates it on testnet and adds USDC"} before you submit.
        </p>
        <WalletButton pubkey={null} className="mt-4" />
        {xNote ? (
          <p role="status" className="mt-3 text-[12.5px] text-muted">
            {xNote.text}
          </p>
        ) : null}
        <div className="mt-5 rounded-lg border border-line bg-sunken p-4">
          <p className="text-[13px] font-semibold">First time? About a minute:</p>
          <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-[13px] leading-normal text-text-2 marker:font-mono marker:text-muted">
            <li>
              <a href={FREIGHTER_URL} target="_blank" rel="noreferrer" className="rounded-sm font-medium text-accent hover:underline">
                Install Freighter ↗
              </a>{" "}
              and create a wallet.
            </li>
            <li>{publicEnv.isMainnet ? "Keep Freighter on Main Net, the network it starts on." : "In Freighter settings, switch the network to Testnet."}</li>
            <li>Come back to this tab and press Connect wallet.</li>
          </ol>
        </div>
      </>
    );
  }
  return (
    <>
      <h2 className="text-lg font-semibold tracking-[-0.02em]">Submit your post</h2>
      <XConnectStep campaignSlug={c.slug} connected={xConnected} available={xAvailable} notice={xNote} />
      <WalletOnboarding key={pubkey} campaignSlug={c.slug} address={pubkey} x={{ connected: xConnected, available: xAvailable }} />
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
