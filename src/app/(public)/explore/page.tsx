import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { stageOf, xExploreNotice, type Stage } from "@/components/contributor-state";
import { amount } from "@/components/site/amount";
import type { BountyCardData } from "@/components/site/bounty-card";
import { BountyGrid, RollingTotal } from "@/components/site/directory";
import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";
import { publicEnv } from "@/config/public-env";
import { xOutcomeSchema } from "@/domain/x-connect";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { publicDirectory, publicTotals, recentPayouts, type DirectoryRow } from "@/services/public-directory";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open bounties",
  description: `Escrow-funded bounties on ${publicEnv.networkName}. Do the task, get reviewed by a person, get paid in USDC.`,
};

const STAGE_LABEL: Record<Stage, string> = {
  open: "Open",
  closed: "Closed",
  ended: "Deadline passed",
  unfunded: "Not funded yet",
};

function card(c: DirectoryRow, now: Date): BountyCardData {
  const stage = stageOf(c, now.getTime());
  return {
    slug: c.slug,
    title: c.title,
    team: c.team,
    reward: amount(c.rewardAmount),
    budget: amount(c.budget),
    paid: c.paid,
    submissions: c.submissions,
    open: c.open,
    deadline: c.deadlineAt.toISOString(),
    distance: formatRelative(c.deadlineAt, now),
    status: STAGE_LABEL[stage],
    dateLabel: formatDateShort(c.closedAt ?? c.deadlineAt),
  };
}

/** Public campaign directory: no wallet needed to browse; one is asked for only on submit. */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ x?: string | string[] }> }) {
  const now = new Date();
  const [list, totals, paid] = await Promise.all([publicDirectory(undefined, now), publicTotals(), recentPayouts()]);
  // An X connect attempt that could not be tied to a campaign ends here with its outcome.
  const xOutcome = xOutcomeSchema.safeParse((await searchParams).x);
  const notice = xExploreNotice(xOutcome.success ? xOutcome.data : null);
  const open = list.filter((c) => c.open);
  const past = list.filter((c) => !c.open);
  const words = ["Open", "now."];

  return (
    <div className="bg-canvas text-white">
      <section className="px-5 pb-16 pt-32 sm:px-6 md:pt-40">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
            <div>
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">
                <span className="size-1.5 shrink-0 animate-ping rounded-full bg-accent text-accent" />
                Bounties on {publicEnv.networkName}
                <span className="hidden sm:inline">· funded before they open</span>
              </p>
              <h1 className={`mt-4 text-[clamp(4.2rem,13vw,10.5rem)] leading-[0.82] ${FONT}`} style={{ fontVariationSettings: axes(68, 900) }}>
                {words.map((w, i) => (
                  <span key={w} className="mr-[0.2em] inline-block overflow-y-clip -mt-[0.12em] pt-[0.12em] pb-[0.04em] align-top">
                    <span className="inline-block animate-rise" style={{ animationDelay: `${80 + i * 90}ms` }}>
                      {i === 1 ? (
                        <>
                          now<span className="text-accent">.</span>
                        </>
                      ) : (
                        w
                      )}
                    </span>
                  </span>
                ))}
              </h1>
            </div>
            <dl className="grid min-w-[16rem] grid-cols-2 gap-x-8 gap-y-5 pb-3">
              <div className="col-span-2 flex flex-col-reverse">
                <dt className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">USDC released</dt>
                <dd className={`text-[clamp(3.5rem,7vw,5.5rem)] leading-[0.82] text-accent ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
                  <RollingTotal value={amount(totals.paidAmount)} />
                </dd>
              </div>
              <Stat label="Payouts" value={totals.payouts} />
              <Stat label="Decisions on-chain" value={totals.decisions} />
            </dl>
          </div>
          {notice ? (
            <p
              role={notice.tone === "fail" ? "alert" : "status"}
              className={cx("mt-8 rounded-2xl px-5 py-4 text-sm", notice.tone === "fail" ? "bg-fail-soft text-fail" : "bg-white/[0.06] text-muted")}
            >
              {notice.text}
            </p>
          ) : null}

          <div className="mt-14">
            {list.length === 0 ? (
              <div className="rounded-[30px] border border-dashed border-white/15 px-6 py-20 text-center">
                <p className={`text-4xl ${FONT}`} style={{ fontVariationSettings: axes(85, 850) }}>
                  No live campaigns yet.
                </p>
                <p className="mt-3 text-white/60">The first campaign appears here as soon as its budget is in escrow.</p>
              </div>
            ) : (
              <>
                <GroupHead title="Taking posts" count={open.length} note="Each card is a funded escrow; the slots are the posts it can still pay for." />
                {open.length === 0 ? (
                  <p className="rounded-[30px] border border-dashed border-white/15 px-6 py-14 text-center text-white/60">No campaign is open right now.</p>
                ) : (
                  <BountyGrid items={open.map((c) => card(c, now))} variant="open" />
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-label="How it works" className="px-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-10 gap-y-4 border-y border-white/10 py-8">
          <p className="max-w-2xl text-[17px] leading-relaxed text-white/70">
            <span className="font-semibold text-white">New here?</span> Do the task and post it on X, then submit the link with a Stellar
            {publicEnv.isMainnet ? "" : " testnet"} wallet. A person reviews it, and a pass is paid from escrow in{publicEnv.isMainnet ? "" : " testnet"} USDC.
            No wallet needed to look around.
          </p>
          <Link href="/#how" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold transition-colors hover:bg-white hover:text-black">
            Follow one post to payout <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {past.length > 0 ? (
        <section className="px-5 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <GroupHead title="Ended" count={past.length} note="Closed or past their deadline. Every payout they made stays on chain." />
            <BountyGrid items={past.map((c) => card(c, now))} variant="past" />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="paid-title" className="bg-accent px-5 py-20 text-black sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 id="paid-title" className={`text-[clamp(3rem,8vw,6.5rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
              Recent payouts.
            </h2>
            <p className="max-w-xs text-sm text-black/75">
              Running a campaign?{" "}
              <Link href="/custody" className="rounded-sm font-semibold underline decoration-black/40 underline-offset-4 hover:decoration-black">
                See where the budget sits
              </Link>
              .
            </p>
          </div>
          {paid.length === 0 ? (
            <p className="mt-8 text-lg">The first payout shows up here with its transaction.</p>
          ) : (
            <ul className="mt-10 border-t-2 border-black">
              {paid.map((p) => (
                <li key={p.releaseTxHash} className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2 border-b border-black/20 py-4 sm:grid-cols-[8rem_1fr_auto]">
                  <span className={`text-4xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                    +{amount(p.amount)}
                  </span>
                  <span className="min-w-0">
                    <Link href={`/c/${p.campaignSlug}`} className="block truncate rounded-sm font-semibold hover:underline">
                      {p.campaignTitle}
                    </Link>
                    <span className="block text-sm text-black/65">USDC released · {formatRelative(p.releasedAt, now)}</span>
                  </span>
                  <a
                    href={publicEnv.explorerTxUrl(p.releaseTxHash)}
                    target="_blank"
                    rel="noreferrer"
                    title={p.releaseTxHash}
                    className="col-span-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-black px-4 py-2 font-mono text-xs text-white transition-transform hover:-translate-y-0.5 sm:col-span-1"
                  >
                    {truncateMiddle(p.releaseTxHash, 6, 4)} <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 max-w-lg text-sm text-black/70">Amounts are what left the escrow; the contributor receives each less the 0.3% protocol fee.</p>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold">
            How Proofwork works <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">{label}</dt>
      <dd className={`text-4xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(75, 900) }}>
        {value}
      </dd>
    </div>
  );
}

function GroupHead({ title, count, note }: { title: string; count: number; note: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h2 className={`flex items-center gap-3 text-[clamp(2rem,4vw,3rem)] leading-none ${FONT}`} style={{ fontVariationSettings: axes(85, 850) }}>
        {title}
        <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-sm font-medium tracking-normal" style={{ fontVariationSettings: "normal" }}>
          {count}
        </span>
      </h2>
      <p className="max-w-sm text-sm text-white/60">{note}</p>
    </div>
  );
}
