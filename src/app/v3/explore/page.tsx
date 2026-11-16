import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileCheck2, PenLine, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shad/card";
import { plainAmount, UsdcIcon } from "@/components/v3/bits";
import { ExploreList, type ExploreItem } from "@/components/v3/explore-list";
import { publicEnv } from "@/config/public-env";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { publicDirectory, publicTotals, recentPayouts } from "@/services/public-directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bounties" };

const HOW = [
  { icon: PenLine, title: "Do the task", body: "Read the brief and post on X." },
  { icon: Wallet, title: "Submit the link", body: "Connect a Stellar wallet and paste your post." },
  { icon: FileCheck2, title: "Get reviewed and paid", body: "A person scores it. A pass is paid from escrow." },
] as const;

export default async function ExploreV3() {
  const now = new Date();
  const [list, totals, paid] = await Promise.all([publicDirectory(undefined, now), publicTotals(), recentPayouts(7)]);
  const items: ExploreItem[] = list.map((c) => {
    const paidAmount = Number(c.rewardAmount) * c.paid;
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      brief: c.brief,
      team: c.team,
      reward: plainAmount(c.rewardAmount),
      budget: plainAmount(c.budget),
      paidAmount: plainAmount(String(paidAmount)),
      paidPct: Math.min(100, Math.round((paidAmount / Number(c.budget)) * 100)),
      open: c.open,
      when: c.open ? `closes ${formatRelative(c.deadlineAt, now)}` : `ended ${formatDateShort(c.closedAt ?? c.deadlineAt).split(" · ")[0]}`,
      submissions: c.submissions,
      paid: c.paid,
    };
  });

  return (
    <>
      <section className="grid gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Get paid for work a person checks.</h1>
          <p className="mt-3 max-w-xl text-base text-muted-foreground">
            Every bounty here has its budget locked in escrow before it opens. Post on X, submit the link, and a reviewer decides.
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card">
          {[
            ["Paid out", `${plainAmount(totals.paidAmount)} USDC`],
            ["Payouts", String(totals.payouts)],
            ["Reviews on-chain", String(totals.decisions)],
          ].map(([label, value]) => (
            <div key={label} className="px-5 py-3.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ExploreList items={items} />

        <aside className="space-y-5">
          <Card className="gap-4 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-sm">How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              {HOW.map((s) => (
                <div key={s.title} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                    <s.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-[13px] text-muted-foreground">{s.body}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="gap-2 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-sm">Recent payouts</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              {paid.length === 0 ? (
                <p className="px-3 text-[13px] text-muted-foreground">The first payout shows up here with its transaction.</p>
              ) : (
                <ul>
                  {paid.map((p) => (
                    <li key={p.releaseTxHash}>
                      <a
                        href={publicEnv.explorerTxUrl(p.releaseTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted"
                      >
                        <UsdcIcon className="size-7" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{p.campaignTitle}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatRelative(p.releasedAt, now)} · tx {truncateMiddle(p.releaseTxHash, 4, 4)}
                          </span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-success">+{plainAmount(p.amount)}</span>
                        <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <p className="px-1 text-[13px] text-muted-foreground">
            Running a campaign?{" "}
            <Link href="/custody" className="font-medium text-foreground underline underline-offset-4">
              See where the budget sits
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}
