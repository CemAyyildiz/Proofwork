import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { publicEnv } from "@/config/public-env";
import { formatRelative, truncateMiddle } from "@/lib/format";
import { labData, plain, seed, type LabItem } from "../data";

export const dynamic = "force-dynamic";

const TILES = ["#ff90e8", "#8fb4ff", "#ffc900", "#6fe0c4", "#ff8a65", "#c9b6ff"] as const;
const DISPLAY = "[font-family:var(--font-archivo-black)]";
const HARD = "border-2 border-black shadow-[6px_6px_0_0_#000]";

function Tile({ item }: { item: LabItem }) {
  const colour = item.open ? (TILES[seed(item.slug) % TILES.length] ?? TILES[0]) : "#ffffff";
  return (
    <Link
      href={`/c/${item.slug}`}
      style={{ backgroundColor: colour }}
      className={`group flex min-h-[340px] flex-col rounded-[4px] p-6 transition-transform duration-150 hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[10px_10px_0_0_#000] ${HARD}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide">{item.team}</span>
        <span className="text-xs font-bold uppercase tracking-wide">{item.open ? `Closes ${item.distance}` : "Ended"}</span>
      </div>
      <p className={`mt-8 text-[88px] leading-[0.8] ${DISPLAY}`}>
        {item.reward}
        <span className="ml-2 align-top text-xl">USDC</span>
      </p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide">per approved post</p>
      <h3 className="mt-6 text-2xl font-bold leading-tight">{item.title}</h3>
      <div className="mt-auto flex items-end justify-between pt-8">
        <p className="text-sm font-semibold">
          {item.submissions} submitted · {item.paid} paid
        </p>
        <span className="grid size-12 place-items-center rounded-full border-2 border-black bg-black text-white transition-colors group-hover:bg-white group-hover:text-black">
          <ArrowRight className="size-5" />
        </span>
      </div>
    </Link>
  );
}

export default async function PosterDirection() {
  const { items, totals, paid, now } = await labData();
  const open = items.filter((i) => i.open);
  const ended = items.filter((i) => !i.open);
  const ticker = paid.length > 0 ? [...paid, ...paid] : [];

  return (
    <div className="min-h-screen bg-[#fffdf5] text-black">
      {ticker.length > 0 ? (
        <div className="overflow-hidden bg-black py-2.5 text-[#fdda24]">
          <div className="lab-marquee flex w-max gap-12 whitespace-nowrap text-sm font-bold uppercase tracking-wide">
            {ticker.map((p, i) => (
              <span key={`${p.releaseTxHash}-${i}`}>
                +{plain(p.amount)} USDC paid · {p.campaignTitle} · {formatRelative(p.releasedAt, now)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <header className="border-b-2 border-black bg-[#fdda24]">
        <nav className="mx-auto flex max-w-[1320px] items-center justify-between px-6 py-5">
          <Link href="/lab/a" className={`text-2xl ${DISPLAY}`}>
            PROOFWORK
          </Link>
          <div className="flex items-center gap-7 text-sm font-bold uppercase tracking-wide">
            <Link href="/lab/a" className="hidden underline decoration-2 underline-offset-4 sm:block">
              Bounties
            </Link>
            <Link href="/verify" className="hidden sm:block">
              Verify
            </Link>
            <Link href="/custody" className="hidden sm:block">
              Custody
            </Link>
            <Link href="/campaigns" className="rounded-full border-2 border-black bg-black px-5 py-2.5 text-white hover:bg-white hover:text-black">
              Fund a bounty
            </Link>
          </div>
        </nav>
        <div className="mx-auto grid max-w-[1320px] gap-10 px-6 pb-14 pt-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
          <div>
            <h1 className={`text-[clamp(56px,10.5vw,164px)] uppercase leading-[0.84] tracking-[-0.02em] ${DISPLAY}`}>
              Post it.
              <br />
              Prove it.
              <br />
              Get paid.
            </h1>
            <p className="mt-7 max-w-xl text-xl font-medium leading-snug">
              Teams lock the budget in escrow first. You post on X, a person reviews it, and a pass pays out in USDC.
            </p>
          </div>
          <div className={`rotate-2 rounded-[4px] bg-white p-6 ${HARD}`}>
            <p className="text-xs font-bold uppercase tracking-wide">Paid out so far</p>
            <p className={`mt-2 text-6xl leading-none ${DISPLAY}`}>{plain(totals.paidAmount)}</p>
            <p className="text-sm font-bold uppercase">USDC</p>
            <div className="mt-5 grid grid-cols-2 gap-3 border-t-2 border-black pt-4 text-sm font-semibold">
              <p>
                <span className={`block text-2xl ${DISPLAY}`}>{totals.payouts}</span>payouts
              </p>
              <p>
                <span className={`block text-2xl ${DISPLAY}`}>{totals.decisions}</span>reviews on-chain
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-6 pb-28">
        <div className="flex items-baseline justify-between pb-6 pt-14">
          <h2 className={`text-4xl uppercase sm:text-5xl ${DISPLAY}`}>Open now</h2>
          <span className="rounded-full border-2 border-black bg-[#fdda24] px-4 py-1.5 text-sm font-bold">{open.length} bounties</span>
        </div>
        <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((i) => (
            <Tile key={i.id} item={i} />
          ))}
        </div>

        <section className="mt-24 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h2 className={`pb-6 text-4xl uppercase ${DISPLAY}`}>Latest payouts</h2>
            <div className={`overflow-hidden rounded-[4px] bg-white ${HARD}`}>
              {paid.map((p, i) => (
                <a
                  key={p.releaseTxHash}
                  href={publicEnv.explorerTxUrl(p.releaseTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex items-center gap-4 px-5 py-4 hover:bg-[#fdda24] ${i > 0 ? "border-t-2 border-black" : ""}`}
                >
                  <span className={`w-24 text-2xl ${DISPLAY}`}>+{plain(p.amount)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{p.campaignTitle}</span>
                    <span className="block font-mono text-xs">tx {truncateMiddle(p.releaseTxHash, 6, 6)}</span>
                  </span>
                  <span className="text-sm font-semibold">{formatRelative(p.releasedAt, now)}</span>
                  <ArrowUpRight className="size-5" />
                </a>
              ))}
            </div>
          </div>
          <div>
            <h2 className={`pb-6 text-4xl uppercase ${DISPLAY}`}>Ended</h2>
            <div className="grid gap-5">
              {ended.map((i) => (
                <Link key={i.id} href={`/c/${i.slug}`} className={`flex items-center gap-5 rounded-[4px] bg-white px-5 py-4 hover:bg-[#f1efe4] ${HARD}`}>
                  <span className={`text-3xl ${DISPLAY}`}>{i.reward}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-bold">{i.title}</span>
                    <span className="block text-sm font-medium">
                      {i.team} · {i.paid} paid of {i.submissions}
                    </span>
                  </span>
                  <span className="rounded-full border-2 border-black px-3 py-1 text-xs font-bold uppercase">Ended</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
