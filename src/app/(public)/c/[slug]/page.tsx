import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { stageOf, xNotice, type Stage } from "@/components/contributor-state";
import { SubmissionPanel } from "@/components/site/submission-panel";
import { EscrowCard } from "@/components/escrow-card";
import { amount, netOfFee } from "@/components/site/amount";
import { Payouts, ReviewQuestions, StickyTicket, SubmitBar, TicketClock } from "@/components/site/bounty";
import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";
import { leftOf } from "@/components/workspace/campaign-list";
import { campaignFor } from "./campaign";
import { xConfig } from "@/config/env";
import { testnetFallback } from "@/config/network";
import { publicEnv } from "@/config/public-env";
import { PASS_THRESHOLD } from "@/domain/rubric";
import { xOutcomeSchema } from "@/domain/x-connect";
import { getEscrow } from "@/escrow";
import { fromStroops, toStroops } from "@/escrow/amount";
import { currentUser } from "@/lib/current-user";
import { formatDateShort, formatRelative, formatUsdc, truncateMiddle } from "@/lib/format";
import { log } from "@/lib/logger";
import { campaignFacts, campaignPayouts } from "@/services/public-directory";
import { mySubmission, type PublicCampaign } from "@/services/submission";
import { xAccountFor } from "@/services/x-account";

export const dynamic = "force-dynamic";

/** Longest the page waits on the live escrow balance before rendering without it. */
const BALANCE_TIMEOUT_MS = 4_000;

const STATUS: Record<Stage, string> = { open: "Open", closed: "Closed", ended: "Deadline passed", unfunded: "Not funded yet" };

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];

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

/** Contributor-facing campaign page: the task, how it is judged, the live escrow, submit and your own status, and what it has paid. */
export default async function ContributorCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ x?: string | string[] }>;
}) {
  const { slug } = await params;
  const c = await campaignFor(slug);
  if (!c) {
    const elsewhere = testnetFallback(publicEnv.network, "c", slug);
    if (elsewhere) redirect(elsewhere);
    notFound();
  }

  const user = await currentUser();
  const mine = user ? await mySubmission(c.id, user.pubkey) : null;
  const stage = stageOf(c);

  // The X step belongs to the submit panel only: open campaign, nothing submitted yet.
  // It gates the form: the server accepts a post only from the connected account.
  const submitting = stage === "open" && !mine;
  const xConnected = submitting && user ? (await xAccountFor(user.pubkey)) !== null : false;
  const xAvailable = xConfig() !== null;
  const xOutcome = xOutcomeSchema.safeParse((await searchParams).x);
  const notice = submitting ? xNotice(xOutcome.success ? xOutcome.data : null, { signedIn: user !== null, connected: xConnected }) : null;

  const now = new Date();
  const [facts, payouts] = await Promise.all([campaignFacts(c.id), campaignPayouts(c.id)]);
  const money = moneyOf(c, stage, payouts.map((p) => p.amount), facts.paid);
  const reward = amount(c.rewardAmount);
  // The next thing a contributor does here, for the phone's bottom bar.
  const next = !user ? "Connect a wallet to submit" : xAvailable && !xConnected ? "Connect X to submit" : "Submit your post";

  return (
    <div className="bg-canvas">
      <Hero c={c} stage={stage} team={facts.team} submissions={facts.submissions} money={money} reward={reward} mine={mine !== null} />

      <section data-surface="paper" className="bg-paper px-5 py-16 text-paper-ink sm:px-6 md:py-20">
        <div className="mx-auto grid max-w-6xl items-start gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">The task</p>
            <p className="mt-5 max-w-2xl whitespace-pre-wrap text-[clamp(1.1rem,1.6vw,1.35rem)] leading-[1.6] [overflow-wrap:anywhere]">{c.brief}</p>
          </div>

          <aside
            id="submit"
            aria-label="Reward and your submission"
            data-bar-hide
            className="min-w-0 scroll-mt-24 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-stretch"
          >
            <StickyTicket>
              <Ticket c={c} stage={stage} money={money}>
                <SubmissionPanel c={c} stage={stage} signedIn={user !== null} pubkey={user?.pubkey ?? null} mine={mine} xConnected={xConnected} xAvailable={xAvailable} xNote={notice} />
              </Ticket>
            </StickyTicket>
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">How you&rsquo;re reviewed</p>
            <h2 className={`mt-3 text-[clamp(2.2rem,4.5vw,3.8rem)] leading-[0.92] ${FONT}`} style={{ fontVariationSettings: axes(85, 850) }}>
              Six questions.
              <br />
              {WORDS[PASS_THRESHOLD] ?? PASS_THRESHOLD} yeses pass.
            </h2>
            <p className="mt-4 max-w-xl text-black/65">
              A person makes the call on each one, the decision and its reason are written to Stellar, and you can request one re-review if you
              disagree. The funder gives final approval.
            </p>
            <ReviewQuestions />
          </div>

          <div className="min-w-0 lg:col-start-1 lg:row-start-3">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">Where the money is</p>
            <h2 className={`mb-6 mt-3 text-[clamp(2.2rem,4.5vw,3.8rem)] leading-[0.92] ${FONT}`} style={{ fontVariationSettings: axes(85, 850) }}>
              In escrow, not with us.
            </h2>
            {c.escrowContractId ? (
              <Suspense fallback={<EscrowCard contractId={c.escrowContractId} balance={null} loading budget={c.budget} recorded={money.expected} closed={stage === "closed"} remainderTxHash={c.remainderTxHash} />}>
                <LiveEscrowCard slug={slug} contractId={c.escrowContractId} budget={c.budget} recorded={money.expected} closed={stage === "closed"} remainderTxHash={c.remainderTxHash} />
              </Suspense>
            ) : (
              <EscrowCard contractId={null} balance={null} budget={c.budget} recorded={null} closed={stage === "closed"} remainderTxHash={c.remainderTxHash} />
            )}
          </div>
        </div>
      </section>

      <Payouts
        fee={{ gross: reward, net: amount(netOfFee(c.rewardAmount)) }}
        payouts={payouts.map((p) => ({
          shortId: p.shortId,
          amount: amount(p.amount),
          hash: truncateMiddle(p.releaseTxHash, 6, 6),
          href: publicEnv.explorerTxUrl(p.releaseTxHash),
          ago: formatRelative(p.releasedAt, now),
          verify: p.decisionId ? `/verify/${p.decisionId}` : null,
        }))}
      />

      {stage === "open" && !mine ? <SubmitBar label={`${next} · ${formatUsdc(c.rewardAmount)}`} /> : null}
    </div>
  );
}

/* ───────────────────────────── the money, as this page may state it ───────────────────────────── */

interface Money {
  /** The budget reached the escrow. Before that there is a budget, never money "left". */
  funded: boolean;
  closed: boolean;
  budget: string;
  /** Posts the budget pays for at this reward. */
  total: number;
  paidCount: number;
  /** USDC released so far, a decimal string. */
  paid: string;
  /** Budget less what was released, never below zero. */
  left: string;
  /** What the escrow should hold by Proofwork's records, to set beside the live read; null before funding. */
  expected: string | null;
}

/** Figures in stroops, never floats: the same rule as the funder's campaign list (workspace/campaign-list.tsx). */
function moneyOf(c: PublicCampaign, stage: Stage, released: readonly string[], paidCount: number): Money {
  const paid = fromStroops(released.reduce((sum, a) => sum + toStroops(a), 0n));
  const left = leftOf(c.budget, paid);
  const per = toStroops(c.rewardAmount);
  const closed = c.funded && stage === "closed";
  return {
    funded: c.funded,
    closed,
    budget: c.budget,
    total: per > 0n ? Number(toStroops(c.budget) / per) : 0,
    paidCount,
    paid,
    left,
    expected: !c.funded ? null : closed && c.remainderTxHash ? "0" : left,
  };
}

/** One line on what happened to the rest of a closed budget. */
function remainderLine(c: PublicCampaign, m: Money): string {
  if (c.remainderTxHash) return "remainder returned to the funder";
  return toStroops(m.left) > 0n ? "remainder return pending" : "nothing left over";
}

/* ───────────────────────────── hero: title, the reward, the escrow drawn as slots ───────────────────────────── */

function Hero({
  c,
  stage,
  team,
  submissions,
  money,
  reward,
  mine,
}: {
  c: PublicCampaign;
  stage: Stage;
  team: string | null;
  submissions: number;
  money: Money;
  reward: string;
  mine: boolean;
}) {
  const words = c.title.split(/\s+/);
  const open = stage === "open";
  const { funded, closed, total, paidCount: paid } = money;
  const shown = Math.min(Math.max(total, 1), 60);
  const now = new Date();
  return (
    <section className="relative overflow-hidden bg-canvas px-5 pb-14 pt-32 text-white sm:px-6 md:pt-36">
      <div className="mx-auto max-w-6xl">
        <Link href="/explore" className="inline-flex min-h-11 items-center gap-1.5 rounded-full font-mono text-[11px] uppercase tracking-[0.18em] text-white/55 transition-colors hover:text-white">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> All bounties
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/60">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider",
              open ? "border-white/35 text-white" : "border-transparent bg-white/10 text-white/70",
            )}
          >
            <span aria-hidden="true" className={cx("size-1.5 rounded-full bg-current", open && "animate-ping")} />
            {/* An unfunded draft past its deadline will never open: it says so rather than "not funded yet". */}
            {funded || stage === "ended" ? STATUS[stage] : STATUS.unfunded}
          </span>
          {team ? (
            <span>
              by <span className="font-semibold text-white">{team}</span>
            </span>
          ) : null}
          <span>
            {submissions} {submissions === 1 ? "submission" : "submissions"}
          </span>
          {paid > 0 ? <span className="text-accent">{paid} paid</span> : null}
          <span>{open ? `closes ${formatRelative(c.deadlineAt, now)}` : stage === "closed" ? `closed ${formatDateShort(c.closedAt ?? c.deadlineAt)}` : `deadline ${formatDateShort(c.deadlineAt)}`}</span>
          <span className="hidden sm:inline">Reviewed by a person</span>
        </div>
        <h1 className={`mt-6 max-w-5xl text-[clamp(2.6rem,7.2vw,6.8rem)] leading-[0.9] [overflow-wrap:anywhere] ${FONT}`} style={{ fontVariationSettings: axes(84, 850) }}>
          {words.map((w, i) => (
            <span key={i} className="mr-[0.22em] inline-block overflow-y-clip -mt-[0.12em] pt-[0.12em] pb-[0.06em] align-top">
              <span className="inline-block animate-rise" style={{ animationDelay: `${80 + i * 55}ms` }}>
                {w}
              </span>
            </span>
          ))}
        </h1>

        <div className="mt-12 grid items-end gap-8 md:grid-cols-[1fr_auto] md:gap-10">
          {/* On a phone the reward always sits above its words, so a short one ("2") stays as big as a long one. */}
          <div className="flex flex-col gap-y-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-5">
            {/* Yellow is money in escrow: an unfunded bounty's reward is a promise, set in white. */}
            <p className={cx(`text-[clamp(6.5rem,19vw,15rem)] leading-[0.78] ${FONT}`, funded ? "text-accent" : "text-white")} style={{ fontVariationSettings: axes(62, 900) }}>
              {reward}
            </p>
            <div className="pb-3">
              <p className="text-xl font-semibold">USDC{publicEnv.isMainnet ? "" : <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">testnet</span>}</p>
              <p className="text-sm text-white/60">for every approved post</p>
              <p className="mt-2 max-w-[16rem] text-xs leading-relaxed text-white/55">
                The escrow takes its 0.3% protocol fee from each payout, so {reward} arrives as {amount(netOfFee(c.rewardAmount))}.{" "}
                {publicEnv.isMainnet ? "Paid in USDC on Stellar mainnet." : "Testnet USDC, not real money."}
              </p>
            </div>
          </div>
          <div data-bar-hide className="flex flex-wrap gap-3 pb-3">
            {open && !mine ? (
              <a href="#submit" className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-4 font-semibold text-black transition-transform hover:scale-[1.03]">
                Submit your post <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </a>
            ) : mine ? (
              <a href="#submit" className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-4 font-semibold text-black transition-transform hover:scale-[1.03]">
                Your submission <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </a>
            ) : null}
            {c.escrowContractId ? (
              <a
                href={publicEnv.explorerContractUrl(c.escrowContractId)}
                target="_blank"
                rel="noreferrer"
                title={c.escrowContractId}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-4 text-sm font-semibold transition-colors hover:bg-white hover:text-black"
              >
                Escrow <span className="font-mono">{truncateMiddle(c.escrowContractId, 6, 6)}</span> <ArrowUpRight className="size-4" aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-12">
          <div className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(shown, 30)}, minmax(0, 1fr))` }} aria-hidden="true">
            {Array.from({ length: shown }, (_, i) => {
              const done = i < paid;
              return (
                <span
                  key={i}
                  className={cx(
                    "h-8 animate-pop rounded-[5px] sm:h-10 md:h-14 md:rounded-md",
                    done ? "bg-accent" : !funded ? "border border-dashed border-white/20" : closed ? "bg-white/[0.04]" : "border border-white/15",
                  )}
                  style={{ animationDelay: `${500 + i * 22}ms` }}
                />
              );
            })}
          </div>
          <p className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/55">
            {!funded ? (
              <>
                <span>
                  {total} {total === 1 ? "post" : "posts"} {stage === "ended" ? "budgeted" : "once funded"}
                  {total > shown ? ` (first ${shown} shown)` : ""}
                </span>
                <span>
                  {amount(money.budget)} USDC budget · {stage === "ended" ? "never put in escrow" : "not in escrow yet"}
                </span>
              </>
            ) : closed ? (
              <>
                <span>
                  <span className="text-accent">{paid} paid</span> of {total} · closed{total > shown ? ` (first ${shown} shown)` : ""}
                </span>
                <span>
                  {amount(money.paid)} of {amount(money.budget)} USDC paid out · {remainderLine(c, money)}
                </span>
              </>
            ) : (
              <>
                <span>
                  <span className="text-accent">{paid} paid</span> · {open ? `${Math.max(0, total - paid)} still payable` : "no new posts"}
                  {total > shown ? ` (first ${shown} shown)` : ""}
                </span>
                <span>
                  {amount(money.left)} of {amount(money.budget)} USDC {open ? "left" : "still"} in escrow
                </span>
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── the ticket: the clock, your steps, the budget ───────────────────────────── */

function Ticket({ c, stage, money, children }: { c: PublicCampaign; stage: Stage; money: Money; children: ReactNode }) {
  const open = stage === "open";
  const over = money.funded && (stage === "closed" || stage === "ended");
  return (
    <div data-surface="dark" className="rounded-[28px] bg-black p-6 text-white shadow-[0_24px_48px_-28px_rgba(0,0,0,0.45)] sm:p-7 sm:shadow-[0_40px_100px_-40px_rgba(0,0,0,0.6)]">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">
        {open ? "Closes in" : stage === "ended" ? "Ended" : !money.funded ? "Opens when funded · closes" : "Closed"}
      </p>
      {open ? (
        <TicketClock deadline={c.deadlineAt.toISOString()} label={formatDateShort(c.deadlineAt)} />
      ) : (
        <p className={`text-[2.2rem] leading-none ${FONT}`} style={{ fontVariationSettings: axes(80, 800) }}>
          {formatDateShort(stage === "closed" ? (c.closedAt ?? c.deadlineAt) : c.deadlineAt)}
        </p>
      )}

      {over ? (
        // The final tally: what this bounty paid, and where the rest of the budget is.
        <div className="mt-7 border-t border-white/10 pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">Final tally</p>
          <p className={`mt-3 text-[clamp(3.5rem,6vw,4.5rem)] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
            <span className={money.paidCount > 0 ? "text-accent" : undefined}>{money.paidCount}</span>
            <span className="text-white/45"> / {money.total}</span>
          </p>
          <p className="mt-2 text-sm text-white/60">posts paid from this escrow</p>
        </div>
      ) : null}

      <div className="mt-6 border-t border-white/10 pt-5">{children}</div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-white/55">Budget</dt>
          <dd className="mt-1 font-semibold">{amount(money.budget)} USDC</dd>
        </div>
        {!money.funded ? (
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-white/55">In escrow</dt>
            <dd className="mt-1 font-semibold text-white/70">Not yet</dd>
          </div>
        ) : over ? (
          <>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-white/55">Paid out</dt>
              <dd className="mt-1 font-semibold">{amount(money.paid)} USDC</dd>
            </div>
            <div className="col-span-2">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-white/55">The rest</dt>
              <dd className="mt-1 font-semibold">
                {/* The escrow takes its 0.3% protocol fee from the remainder return too (README, "The close is manual"). */}
                {stage === "closed" && c.remainderTxHash && toStroops(money.left) > 0n
                  ? `${amount(money.left)} USDC returned to the funder, ${amount(netOfFee(money.left))} after the 0.3% fee`
                  : stage === "closed"
                  ? `${amount(money.left)} USDC · ${remainderLine(c, money)}`
                  : `${amount(money.left)} USDC still in escrow, returned to the funder after they close`}
              </dd>
            </div>
          </>
        ) : (
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-white/55">Left</dt>
            <dd className="mt-1 font-semibold">{amount(money.left)} USDC</dd>
          </div>
        )}
      </dl>
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
  recorded: string | null;
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
