import Link from "next/link";
import type { ReactNode } from "react";
import { AppealButton } from "@/components/appeal-button";
import { timelineView, type Stage, type XNotice } from "@/components/contributor-state";
import { Stamp } from "@/components/site/stamp";
import { StepList, StepNote, StepRow } from "@/components/site/steps";
import { axes, FONT } from "@/components/site/type";
import { HashChip } from "@/components/ui/hash-chip";
import { WalletButton } from "@/components/wallet-button";
import { WalletOnboarding } from "@/components/wallet-onboarding";
import { XConnectStep } from "@/components/x-connect";
import { publicEnv } from "@/config/public-env";
import type { Decision } from "@/db/schema";
import { SIGNALS } from "@/domain/rubric";
import { formatDateShort, formatUsdc, shortKey, truncateMiddle } from "@/lib/format";
import type { MySubmission, PublicCampaign } from "@/services/submission";

/** Freighter's own site; the Wallets Kit modal links it too when the extension is missing. */
const FREIGHTER_URL = "https://www.freighter.app";

/*
 * What the black ticket on a bounty page holds, by state: connect, the X and
 * wallet steps and the form, the reason no post is taken, or your own
 * submission's timeline with its decisions.
 */

function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className={`text-[1.6rem] leading-none ${FONT}`} style={{ fontVariationSettings: axes(90, 800) }}>
      {children}
    </h2>
  );
}

export function SubmissionPanel({
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
        <PanelTitle>Your submission</PanelTitle>
        <Timeline mine={mine} campaignOpen={c.open} />
      </>
    );
  }
  if (stage !== "open") {
    return (
      <>
        <PanelTitle>Submissions</PanelTitle>
        <p className="mt-4 rounded-2xl bg-white/[0.06] p-4 text-sm leading-relaxed text-white/70">
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
        <PanelTitle>Submit your post</PanelTitle>
        <StepList className="mt-6">
          <StepRow state="current" title="Connect a Stellar wallet">
            <StepNote>
              The reward is paid to that wallet in USDC. If the wallet is new, this page{" "}
              {publicEnv.isMainnet ? "shows how to open it and adds the USDC trustline" : "activates it on testnet and adds USDC"} before you submit.
            </StepNote>
            <WalletButton pubkey={null} className="mt-3.5 flex-wrap [&>button]:h-12 [&>button]:px-6 [&>button]:text-[15px]" />
            {xNote ? (
              <p role="status" className="mt-3 text-[13px] text-white/60">
                {xNote.text}
              </p>
            ) : null}
            <details className="group/ft mt-4 rounded-2xl bg-white/[0.06] p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
                First time? About a minute
                <span aria-hidden="true" className="text-white/50 transition-transform group-open/ft:rotate-45">
                  +
                </span>
              </summary>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-white/65 marker:font-mono marker:text-white/40">
                <li>
                  <a href={FREIGHTER_URL} target="_blank" rel="noreferrer" className="rounded-sm font-semibold text-accent hover:underline">
                    Install Freighter ↗
                  </a>{" "}
                  and create a wallet.
                </li>
                <li>{publicEnv.isMainnet ? "Keep Freighter on Main Net, the network it starts on." : "In Freighter settings, switch the network to Testnet."}</li>
                <li>Come back to this tab and press Connect wallet.</li>
              </ol>
            </details>
          </StepRow>
          <StepRow state="pending" title="Connect your X account">
            <StepNote>Only posts from that account are accepted.</StepNote>
          </StepRow>
          <StepRow state="pending" title="Paste the link to your post">
            <StepNote>One post per wallet, read by a person.</StepNote>
          </StepRow>
        </StepList>
      </>
    );
  }
  return (
    <>
      <PanelTitle>Submit your post</PanelTitle>
      <StepList className="mt-6">
        <StepRow state="done" title="Wallet connected">
          <StepNote>
            <span className="font-mono" title={pubkey}>
              {shortKey(pubkey)}
            </span>{" "}
            · the reward is paid here.
          </StepNote>
        </StepRow>
        <XConnectStep campaignSlug={c.slug} connected={xConnected} available={xAvailable} notice={xNote} />
        <WalletOnboarding key={pubkey} campaignSlug={c.slug} address={pubkey} x={{ connected: xConnected, available: xAvailable }} />
      </StepList>
    </>
  );
}

function passCount(d: Decision): number {
  return SIGNALS.filter((s) => d.signals[s.id] === true).length;
}

export function Timeline({ mine, campaignOpen }: { mine: MySubmission; campaignOpen: boolean }) {
  const s = mine.submission;
  const { recorded, unrecorded, reReviewPending, canAppeal, paid } = timelineView(mine, campaignOpen);
  const latest = recorded.at(-1) ?? null;
  const shownUrl = s.workUrl.replace(/^https:\/\//, "");

  return (
    <StepList className="mt-6">
      <StepRow state="done" title="Submitted">
        <StepNote>
          <a href={s.workUrl} target="_blank" rel="noreferrer" title={s.workUrl} className="font-mono text-[12.5px] text-white/75 underline decoration-white/25 underline-offset-4 hover:text-white">
            {truncateMiddle(shownUrl, 24, 6)} ↗
          </a>
          <span className="block">{formatDateShort(s.submittedAt)}</span>
        </StepNote>
      </StepRow>

      {recorded.map((d, i) => {
        const isLast = d === latest;
        const pass = d.outcome === "PASS";
        return (
          <StepRow
            key={d.id}
            state={pass ? "done" : "fail"}
            title={
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {i > 0 || d.appealOf ? "Re-review" : "Reviewed"} · <span className={pass ? "text-pass" : "text-fail"}>{d.outcome}</span>
                </span>
                <Stamp outcome={pass ? "PASS" : "FAIL"} size="sm" delay={300 + i * 200} />
              </span>
            }
          >
            <StepNote>
              {passCount(d)} / {SIGNALS.length} · <span className="font-mono">{d.reasonCode}</span>
            </StepNote>
            {d.note ? (
              <blockquote className="mt-2.5 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm leading-relaxed text-white/75 [overflow-wrap:anywhere]">&ldquo;{d.note}&rdquo;</blockquote>
            ) : null}
            <Link href={`/verify/${d.id}`} className="mt-2.5 inline-flex rounded-sm text-[13.5px] font-semibold text-accent hover:underline">
              Verify decision on-chain →
            </Link>
            {isLast && !pass && canAppeal ? <AppealButton submissionId={s.id} /> : null}
          </StepRow>
        );
      })}

      {unrecorded ? (
        <StepRow state="current" title="Recording on Stellar">
          <StepNote>The decision is being written to Stellar. It shows here once the transaction confirms.</StepNote>
        </StepRow>
      ) : reReviewPending ? (
        <StepRow state="current" title="Re-review requested">
          <StepNote>A person will look again. The new decision is also written to Stellar.</StepNote>
        </StepRow>
      ) : recorded.length === 0 ? (
        <StepRow state="current" title="In review">
          <StepNote>Waiting for review. Every post is read by a person.</StepNote>
        </StepRow>
      ) : null}

      {paid ? (
        <StepRow
          state="done"
          title={
            <>
              Paid · <span className="text-accent">{formatUsdc(paid.amount)}</span>
            </>
          }
        >
          <StepNote>Released from escrow to your wallet.</StepNote>
          <HashChip value={paid.releaseTxHash} href={publicEnv.explorerTxUrl(paid.releaseTxHash)} className="mt-2.5" />
        </StepRow>
      ) : (
        <StepRow state="pending" title="Paid">
          <StepNote>
            {latest?.outcome === "FAIL" && !reReviewPending
              ? "Only after a pass."
              : latest?.outcome === "PASS"
                ? "Released from escrow to your wallet once the funder signs."
                : "Released from escrow to your wallet if it passes."}
          </StepNote>
        </StepRow>
      )}
    </StepList>
  );
}
