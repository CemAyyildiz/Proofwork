import Link from "next/link";
import { ArrowUpRight, BadgeCheck, CircleDollarSign, LayoutList, Lock, ShieldCheck } from "lucide-react";
import { publicEnv } from "@/config/public-env";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { campaignPayouts } from "@/services/public-directory";
import { labData, plain, seed } from "../data";

export const dynamic = "force-dynamic";

const DOTS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"] as const;
const dot = (slug: string) => DOTS[seed(slug) % DOTS.length] ?? DOTS[0];

const NAV = [
  { icon: LayoutList, label: "Bounties", href: "/lab/c", on: true },
  { icon: CircleDollarSign, label: "Payouts", href: "/lab/c", on: false },
  { icon: BadgeCheck, label: "Verify a decision", href: "/verify", on: false },
  { icon: ShieldCheck, label: "Custody", href: "/custody", on: false },
] as const;

export default async function AppDirection({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const { c } = await searchParams;
  const { items, totals, now } = await labData();
  const wanted = typeof c === "string" ? c : undefined;
  const current = items.find((i) => i.slug === wanted) ?? items.find((i) => i.open) ?? items[0];
  const payouts = current ? await campaignPayouts(current.id) : [];
  const open = items.filter((i) => i.open);
  const ended = items.filter((i) => !i.open);

  return (
    <div className="grid h-screen grid-cols-1 bg-[#f3f3f1] text-[#0e0e0c] md:grid-cols-[232px_380px_minmax(0,1fr)]">
      <aside className="hidden flex-col bg-[#0e0e0c] p-4 text-[#e9e8e3] md:flex">
        <Link href="/lab/c" className="flex items-center gap-2.5 px-2 py-2 text-[15px] font-semibold">
          <span className="grid size-7 place-items-center rounded-md bg-[#fdda24] text-sm font-bold text-black">P</span>
          Proofwork
        </Link>
        <nav className="mt-6 space-y-0.5 text-sm">
          {NAV.map((n) => (
            <Link key={n.label} href={n.href} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 ${n.on ? "bg-white/10 text-white" : "text-[#a3a199] hover:bg-white/5 hover:text-white"}`}>
              <n.icon className="size-4" />
              {n.label}
              {n.on ? <span className="ml-auto text-xs tabular-nums text-[#a3a199]">{open.length}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-lg bg-[#fdda24] p-4 text-black">
          <p className="text-xs font-medium">Paid out</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{plain(totals.paidAmount)} USDC</p>
          <p className="mt-1 text-xs">
            {totals.payouts} payouts · {totals.decisions} reviews on-chain
          </p>
        </div>
        <Link href="/campaigns" className="mt-3 rounded-md border border-white/15 px-3 py-2 text-center text-sm font-medium hover:bg-white/10">
          Connect wallet
        </Link>
      </aside>

      <section className="flex min-h-0 flex-col border-r border-[#dedcd4] bg-[#fafaf8]">
        <header className="flex items-center justify-between border-b border-[#dedcd4] px-5 py-4">
          <h1 className="text-[15px] font-semibold">Bounties</h1>
          <span className="rounded-md bg-[#ebeae4] px-2 py-0.5 text-xs font-medium tabular-nums">{items.length}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {[
            ["Open", open],
            ["Ended", ended],
          ].map(([label, group]) =>
            typeof label === "string" && Array.isArray(group) && group.length > 0 ? (
              <div key={label}>
                <p className="sticky top-0 border-b border-[#e7e5dd] bg-[#f3f3f1] px-5 py-1.5 text-xs font-medium text-[#74726a]">{label}</p>
                {group.map((i) => {
                  const active = current?.id === i.id;
                  return (
                    <Link
                      key={i.id}
                      href={`/lab/c?c=${i.slug}`}
                      scroll={false}
                      className={`block border-b border-[#e7e5dd] px-5 py-3.5 ${active ? "bg-white shadow-[inset_3px_0_0_0_#0e0e0c]" : "hover:bg-white/70"}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-[#74726a]">
                        <span className="size-2 rounded-full" style={{ backgroundColor: dot(i.slug) }} />
                        <span className="truncate">{i.team}</span>
                        <span className="ml-auto shrink-0 tabular-nums">{i.open ? i.distance.replace("in ", "") + " left" : "ended"}</span>
                      </div>
                      <p className={`mt-1.5 truncate text-sm ${active ? "font-semibold" : "font-medium"}`}>{i.title}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-[#74726a]">
                        <span className="font-semibold tabular-nums text-[#0e0e0c]">{i.reward} USDC</span>
                        <span>{i.submissions} submitted</span>
                        <span>{i.paid} paid</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : null,
          )}
        </div>
      </section>

      <main className="hidden min-h-0 overflow-y-auto bg-white md:block">
        {current ? (
          <div className="mx-auto max-w-[760px] px-10 py-9">
            <div className="flex items-center gap-2 text-sm text-[#74726a]">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: dot(current.slug) }} />
              {current.team}
              <span className={`ml-2 rounded-md px-2 py-0.5 text-xs font-medium ${current.open ? "bg-[#e3f4e6] text-[#17642c]" : "bg-[#ebeae4] text-[#55534c]"}`}>{current.open ? "Open" : "Ended"}</span>
            </div>
            <h2 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.02em]">{current.title}</h2>

            <div className="mt-7 grid grid-cols-3 overflow-hidden rounded-xl border border-[#dedcd4]">
              {[
                ["Reward", `${current.reward} USDC`, "per approved post"],
                [current.open ? "Closes" : "Closed", current.distance, formatDateShort(current.deadlineAt)],
                ["Paid from escrow", `${current.paidAmount} USDC`, `of ${current.budget} locked`],
              ].map(([k, v, sub], idx) => (
                <div key={k} className={`px-5 py-4 ${idx > 0 ? "border-l border-[#dedcd4]" : ""}`}>
                  <p className="text-xs text-[#74726a]">{k}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{v}</p>
                  <p className="mt-0.5 text-xs text-[#74726a]">{sub}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#ebeae4]">
              <div className="h-full rounded-full bg-[#0e0e0c]" style={{ width: `${current.paidPct}%` }} />
            </div>

            <div className="mt-7 flex items-center gap-3">
              <Link href={`/c/${current.slug}#submit`} className="inline-flex items-center gap-2 rounded-lg bg-[#0e0e0c] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2a2a26]">
                Submit your post
                <span className="grid size-5 place-items-center rounded-full bg-[#fdda24] text-black">
                  <ArrowUpRight className="size-3.5" />
                </span>
              </Link>
              <span className="inline-flex items-center gap-1.5 text-sm text-[#74726a]">
                <Lock className="size-3.5" />
                Budget is held in escrow, not by Proofwork
              </span>
            </div>

            <h3 className="mt-10 text-sm font-semibold">The task</h3>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-[#3a3934]">{current.brief}</p>

            <h3 className="mt-10 text-sm font-semibold">Payouts</h3>
            {payouts.length === 0 ? (
              <p className="mt-2 text-sm text-[#74726a]">No payout yet. The first one shows up here with its transaction.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#dedcd4] text-left text-xs text-[#74726a]">
                    <th className="py-2 font-medium">Submission</th>
                    <th className="py-2 font-medium">When</th>
                    <th className="py-2 font-medium">Transaction</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.releaseTxHash} className="border-b border-[#eeece6]">
                      <td className="py-2.5 font-mono text-xs">{p.shortId}</td>
                      <td className="py-2.5 text-[#74726a]">{formatRelative(p.releasedAt, now)}</td>
                      <td className="py-2.5">
                        <a href={publicEnv.explorerTxUrl(p.releaseTxHash)} target="_blank" rel="noreferrer" className="font-mono text-xs underline decoration-[#c9c6bb] underline-offset-4 hover:decoration-black">
                          {truncateMiddle(p.releaseTxHash, 6, 6)}
                        </a>
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">+{plain(p.amount)} USDC</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
