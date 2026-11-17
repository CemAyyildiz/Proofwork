import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { publicEnv } from "@/config/public-env";
import { formatRelative, truncateMiddle } from "@/lib/format";
import { labData, plain, type LabItem } from "../data";
import { DISPLAY, PAPER, Perforation, Slots, TopBar } from "./parts";

export const dynamic = "force-dynamic";

function Featured({ item }: { item: LabItem }) {
  return (
    <Link href={`/lab/d/${item.slug}`} className="group relative flex flex-col justify-between rounded-3xl bg-black p-8 text-white transition-transform duration-200 hover:-translate-y-0.5">
      <div>
        <div className="flex items-center gap-2 text-sm text-white/60">
          <span className="rounded-full bg-[#fdda24] px-2.5 py-0.5 text-xs font-semibold text-black">Closing soonest</span>
          {item.team} · closes {item.distance}
        </div>
        <h3 className={`mt-6 max-w-md text-4xl font-semibold leading-[1.05] ${DISPLAY}`}>{item.title}</h3>
        <p className="mt-4 line-clamp-3 max-w-md text-[15px] leading-relaxed text-white/70">{item.brief}</p>
      </div>
      <div className="mt-10">
        <div className="flex items-end justify-between">
          <p className={`text-7xl font-bold leading-none ${DISPLAY}`}>
            {item.reward}
            <span className="ml-2 text-xl font-medium text-white/60">USDC / post</span>
          </p>
          <span className="grid size-14 place-items-center rounded-full bg-[#fdda24] text-black transition-transform group-hover:translate-x-1">
            <ArrowRight className="size-6" />
          </span>
        </div>
        <div className="mt-6">
          <Slots budget={item.budget} reward={item.reward} paid={item.paid} dark />
        </div>
      </div>
    </Link>
  );
}

function Tile({ item }: { item: LabItem }) {
  return (
    <Link href={`/lab/d/${item.slug}`} className="group flex flex-col rounded-3xl bg-white p-6 ring-1 ring-black/[0.06] transition-shadow duration-200 hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between text-sm text-black/55">
        <span>{item.team}</span>
        <span>{item.open ? `closes ${item.distance}` : "ended"}</span>
      </div>
      <h3 className={`mt-3 text-2xl font-semibold leading-tight ${DISPLAY}`}>{item.title}</h3>
      <div className="mt-auto pt-8">
        <p className={`text-5xl font-bold leading-none ${DISPLAY}`}>
          {item.reward}
          <span className="ml-1.5 text-base font-medium text-black/50">USDC / post</span>
        </p>
        <div className="mt-5">
          <Slots budget={item.budget} reward={item.reward} paid={item.paid} />
        </div>
      </div>
    </Link>
  );
}

export default async function LedgerDirection() {
  const { items, totals, paid, now } = await labData();
  const open = [...items.filter((i) => i.open)].sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  const ended = items.filter((i) => !i.open);
  const [first, ...rest] = open;

  return (
    <div className="min-h-screen text-[#111]" style={{ backgroundColor: PAPER }}>
      <TopBar />
      <main className="mx-auto max-w-[1240px] px-6 pb-28">
        <section className="grid gap-10 pb-14 pt-16 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div>
            <h1 className={`text-[clamp(48px,7.4vw,104px)] font-bold leading-[0.92] ${DISPLAY}`}>
              Do the work.
              <br />
              <span className="relative inline-block">
                Keep the receipt.
                <span aria-hidden="true" className="absolute -bottom-1 left-0 -z-10 h-[0.42em] w-full bg-[#fdda24]" />
              </span>
            </h1>
            <p className="mt-8 max-w-lg text-lg leading-relaxed text-black/65">
              Every bounty&rsquo;s budget is locked in escrow before it opens. A person reviews your post, and every payout comes with a transaction anyone can check.
            </p>
            <div className="mt-8 flex gap-3">
              <a href="#open" className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3.5 font-medium text-white hover:bg-black/80">
                See open bounties <ArrowRight className="size-4" />
              </a>
              <Link href="/verify" className="inline-flex items-center rounded-full px-6 py-3.5 font-medium ring-1 ring-black/20 hover:bg-black/5">
                Check a payout
              </Link>
            </div>
          </div>

          <div className="relative -rotate-1 bg-white px-6 pb-8 pt-7 shadow-[0_24px_50px_-28px_rgba(0,0,0,0.5)]">
            <Perforation side="top" />
            <Perforation side="bottom" />
            <div className="flex items-baseline justify-between border-b border-dashed border-black/25 pb-3 font-mono text-[11px] uppercase tracking-wider text-black/55">
              <span>Payout ledger</span>
              <span>{publicEnv.networkName}</span>
            </div>
            <ul className="divide-y divide-dashed divide-black/15 font-mono text-[13px]">
              {paid.slice(0, 6).map((p) => (
                <li key={p.releaseTxHash}>
                  <a href={publicEnv.explorerTxUrl(p.releaseTxHash)} target="_blank" rel="noreferrer" className="flex items-baseline gap-3 py-2.5 hover:bg-[#fdda24]/30">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-sm text-black">{p.campaignTitle}</span>
                      <span className="text-[11px] text-black/45">
                        tx {truncateMiddle(p.releaseTxHash, 5, 5)} · {formatRelative(p.releasedAt, now)}
                      </span>
                    </span>
                    <span className="font-semibold text-[#0a7d3b]">+{plain(p.amount)}</span>
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t-2 border-black pt-3">
              <span className="font-mono text-[11px] uppercase tracking-wider">Total paid · {totals.payouts} payouts</span>
              <span className={`text-3xl font-bold ${DISPLAY}`}>{plain(totals.paidAmount)} USDC</span>
            </div>
            <span className="absolute -right-4 -top-5 rotate-[8deg] bg-white rounded-md border-[3px] border-[#0a7d3b] px-2 py-0.5 font-mono text-sm font-bold uppercase tracking-widest text-[#0a7d3b] opacity-80">
              Verified on-chain
            </span>
          </div>
        </section>

        <div id="open" className="flex items-baseline justify-between pb-5">
          <h2 className={`text-3xl font-bold ${DISPLAY}`}>Open bounties</h2>
          <span className="font-mono text-xs uppercase tracking-wider text-black/55">{open.length} open · sorted by closing date</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {first ? <Featured item={first} /> : null}
          <div className="grid gap-4">
            {rest.map((i) => (
              <Tile key={i.id} item={i} />
            ))}
          </div>
        </div>

        {ended.length > 0 ? (
          <section className="mt-16">
            <h2 className={`pb-4 text-xl font-bold ${DISPLAY}`}>Ended</h2>
            <div className="divide-y divide-black/10 rounded-3xl bg-white/60 ring-1 ring-black/[0.06]">
              {ended.map((i) => (
                <Link key={i.id} href={`/lab/d/${i.slug}`} className="flex items-center gap-6 px-6 py-4 hover:bg-white">
                  <span className={`w-16 text-2xl font-bold ${DISPLAY}`}>{i.reward}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.title}</span>
                    <span className="text-sm text-black/55">{i.team}</span>
                  </span>
                  <span className="hidden w-64 sm:block">
                    <Slots budget={i.budget} reward={i.reward} paid={i.paid} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
