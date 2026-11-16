import type { Metadata } from "next";
import Link from "next/link";
import { stageOf, xExploreNotice, type Stage } from "@/components/contributor-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import { xOutcomeSchema } from "@/domain/x-connect";
import { formatDateShort, formatRelative, formatUsdc } from "@/lib/format";
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

const HOW = [
  { title: "Do the task", body: "Read the brief and post on X. No wallet needed to look around." },
  { title: "Submit the link", body: publicEnv.isMainnet ? "Connect a Stellar wallet and paste your post's link." : "Connect a Stellar testnet wallet and paste your post's link." },
  { title: "Get reviewed and paid", body: publicEnv.isMainnet ? "A person scores it; a pass is paid from escrow in USDC." : "A person scores it; a pass is paid from escrow in testnet USDC." },
] as const;

/** Public campaign directory: no wallet needed to browse; one is asked for only on submit. */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ x?: string | string[] }> }) {
  const now = new Date();
  const [list, totals, paid] = await Promise.all([publicDirectory(undefined, now), publicTotals(), recentPayouts()]);
  // An X connect attempt that could not be tied to a campaign ends here with its outcome.
  const xOutcome = xOutcomeSchema.safeParse((await searchParams).x);
  const notice = xExploreNotice(xOutcome.success ? xOutcome.data : null);
  const open = list.filter((c) => c.open);
  const past = list.filter((c) => !c.open);

  return (
    <div className="mx-auto max-w-[1180px] pb-24 pt-2 md:pt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-b border-line pb-7">
        <div>
          <Eyebrow>Campaigns</Eyebrow>
          <h1 className="mt-3 text-[clamp(32px,3.6vw,46px)] font-semibold leading-none tracking-[-0.045em]">
            Open bounties <span className="text-muted">funded before they open.</span>
          </h1>
        </div>
        <dl className="flex gap-8">
          <Stat label="Paid out" value={formatUsdc(totals.paidAmount)} accent />
          <Stat label="Payouts" value={String(totals.payouts)} />
          <Stat label="Decisions on-chain" value={String(totals.decisions)} />
        </dl>
      </div>
      {notice ? (
        <p role={notice.tone === "fail" ? "alert" : "status"} className={notice.tone === "fail" ? "mt-4 text-sm text-fail" : "mt-4 text-sm text-muted"}>
          {notice.text}
        </p>
      ) : null}

      <div className="mt-2 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {list.length === 0 ? (
            <div className="border-b border-line py-14 text-center">
              <p className="text-lg font-semibold tracking-[-0.02em]">No live campaigns yet.</p>
              <p className="mt-2 text-sm text-text-2">The first campaign appears here as soon as its budget is in escrow.</p>
            </div>
          ) : (
            <>
              <Group title="Open" count={open.length} rows={open} now={now} empty="No campaign is open right now." />
              {past.length > 0 ? <Group title="Ended" count={past.length} rows={past} now={now} /> : null}
            </>
          )}
        </div>

        <aside className="grid content-start gap-10 lg:border-l lg:border-line lg:pl-10 lg:pt-7">
          <section aria-labelledby="how-title">
            <Eyebrow as="h2" className="text-[11px]">
              <span id="how-title">How it works</span>
            </Eyebrow>
            <ol className="mt-4 grid gap-4">
              {HOW.map((step, i) => (
                <li key={step.title} className="grid grid-cols-[26px_1fr] gap-3">
                  <span className="grid h-[26px] w-[26px] place-items-center rounded-full border border-line-strong font-mono text-[11px] text-muted">{i + 1}</span>
                  <div>
                    <p className="text-[14px] font-semibold leading-[26px]">{step.title}</p>
                    <p className="text-[13px] leading-normal text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="paid-title">
            <Eyebrow as="h2" className="text-[11px]">
              <span id="paid-title">Recent payouts</span>
            </Eyebrow>
            {paid.length === 0 ? (
              <p className="mt-4 text-[13px] text-muted">The first payout shows up here with its transaction.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {paid.map((p) => (
                  <li key={p.releaseTxHash} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[13.5px] font-medium text-pass">+{formatUsdc(p.amount)}</span>
                      <span className="font-mono text-[11.5px] text-muted">{formatRelative(p.releasedAt, now)}</span>
                    </div>
                    <Link href={`/c/${p.campaignSlug}`} className="mt-1 block truncate rounded-sm text-[13px] text-text-2 hover:text-text">
                      {p.campaignTitle}
                    </Link>
                    <HashChip className="mt-1.5" value={p.releaseTxHash} head={6} tail={4} href={publicEnv.explorerTxUrl(p.releaseTxHash)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[12.5px] leading-normal text-muted">
            Running a campaign?{" "}
            <Link href="/custody" className="rounded-sm text-text-2 underline hover:text-text">
              See where the budget sits
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className={`mt-1.5 font-mono text-[19px] font-medium tracking-[-0.02em] ${accent ? "text-accent" : "text-text"}`}>{value}</dd>
    </div>
  );
}

function Group({ title, count, rows, now, empty }: { title: string; count: number; rows: DirectoryRow[]; now: Date; empty?: string }) {
  return (
    <section>
      <h2 className="flex items-center gap-2.5 pb-2 pt-7 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {title}
        <span className="rounded-full border border-line-strong px-2 py-px text-[10.5px] tracking-normal">{count}</span>
      </h2>
      {rows.length === 0 && empty ? <p className="border-t border-line py-8 text-sm text-muted">{empty}</p> : null}
      <ul className="border-t border-line">
        {rows.map((c) => (
          <Row key={c.id} c={c} now={now} />
        ))}
      </ul>
    </section>
  );
}

/** Two letters for the tile: the team's initials, or the campaign's when the funder has no team name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

function Row({ c, now }: { c: DirectoryRow; now: Date }) {
  const stage = stageOf(c);
  const live = stage === "open";
  return (
    <li className="border-b border-line">
      <Link
        href={`/c/${c.slug}`}
        className="group -mx-3 grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-lg px-3 py-4 transition-colors duration-150 hover:bg-white/3 focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[44px_minmax(0,1fr)_auto]"
      >
        <span
          aria-hidden="true"
          className={`grid h-11 w-11 place-items-center rounded-[10px] border font-mono text-[13px] font-semibold ${
            live ? "border-accent-line bg-accent-soft text-accent" : "border-line-strong bg-white/3 text-muted"
          }`}
        >
          {initials(c.team ?? c.title)}
        </span>
        <div className="min-w-0">
          <p className={`truncate text-[16px] font-semibold tracking-[-0.02em] ${live ? "text-text" : "text-text-2"}`}>{c.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
            {c.team ? <span className="text-text-2">{c.team}</span> : null}
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${live ? "bg-pass" : "bg-faint"}`} />
              {STAGE_LABEL[stage]}
            </span>
            <span className="font-mono">{live ? `closes ${formatRelative(c.deadlineAt, now)}` : formatDateShort(c.closedAt ?? c.deadlineAt)}</span>
            <span className="font-mono">
              {c.submissions} {c.submissions === 1 ? "submission" : "submissions"}
            </span>
            {c.paid > 0 ? <span className="font-mono text-pass">{c.paid} paid</span> : null}
          </p>
        </div>
        <div className="col-start-2 flex items-baseline gap-2 sm:col-start-3 sm:block sm:text-right">
          <p className={`font-mono text-[17px] font-medium tracking-[-0.02em] ${live ? "text-accent" : "text-text-2"}`}>{formatUsdc(c.rewardAmount)}</p>
          <p className="font-mono text-[11px] text-muted sm:mt-0.5">per approved post</p>
        </div>
      </Link>
    </li>
  );
}
