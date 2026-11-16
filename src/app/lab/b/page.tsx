import Link from "next/link";
import { publicEnv } from "@/config/public-env";
import { formatRelative } from "@/lib/format";
import { labData, plain, seed, type LabItem } from "../data";

export const dynamic = "force-dynamic";

const SERIF = "[font-family:var(--font-fraunces)]";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** Soft artwork made from the campaign's slug: three blurred colour fields. No image is fetched. */
function cover(slug: string): React.CSSProperties {
  const s = seed(slug);
  const h1 = s % 360;
  const h2 = (h1 + 40 + ((s >> 8) % 80)) % 360;
  const h3 = (h1 + 200 + ((s >> 16) % 60)) % 360;
  return {
    backgroundColor: `hsl(${h1} 85% 88%)`,
    backgroundImage: [
      `radial-gradient(circle at ${20 + (s % 30)}% ${25 + ((s >> 4) % 30)}%, hsl(${h2} 95% 68%) 0, transparent 55%)`,
      `radial-gradient(circle at ${70 + ((s >> 6) % 25)}% ${65 + ((s >> 10) % 25)}%, hsl(${h3} 90% 70%) 0, transparent 50%)`,
      `radial-gradient(circle at 85% 15%, hsl(${h1} 95% 60%) 0, transparent 45%)`,
    ].join(","),
  };
}

function Row({ item }: { item: LabItem }) {
  const d = item.deadlineAt;
  return (
    <li className="relative grid grid-cols-[92px_minmax(0,1fr)] gap-6 pb-7 sm:grid-cols-[132px_minmax(0,1fr)]">
      <div className="pt-5 text-right">
        <p className="text-[15px] font-semibold text-[#1c1b19]">
          {d.getUTCDate()} {(MONTHS[d.getUTCMonth()] ?? "").slice(0, 3)}
        </p>
        <p className="text-sm text-[#8a867d]">{DAYS[d.getUTCDay()]}</p>
      </div>
      <span aria-hidden="true" className={`absolute left-[101px] top-7 size-2.5 rounded-full ring-4 ring-[#f6f2ea] sm:left-[141px] ${item.open ? "bg-[#1c1b19]" : "bg-[#c9c4b8]"}`} />
      <Link
        href={`/c/${item.slug}`}
        className="group ml-4 flex gap-5 rounded-[22px] bg-white/80 p-4 shadow-[0_1px_2px_rgba(28,27,25,0.05),0_12px_32px_-18px_rgba(28,27,25,0.25)] ring-1 ring-black/[0.04] backdrop-blur transition-shadow duration-200 hover:shadow-[0_1px_2px_rgba(28,27,25,0.06),0_24px_48px_-20px_rgba(28,27,25,0.35)]"
      >
        <div className="min-w-0 flex-1 py-1 pl-2">
          <p className="text-sm text-[#8a867d]">{item.open ? `Closes ${item.distance}` : `Ended ${item.distance}`}</p>
          <h3 className={`mt-1 text-[26px] leading-[1.15] tracking-[-0.01em] text-[#1c1b19] ${SERIF}`}>{item.title}</h3>
          <p className="mt-2 text-[15px] text-[#5d5a53]">By {item.team}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-[#1c1b19] px-3 py-1 font-medium text-white">{item.reward} USDC</span>
            <span className="rounded-full bg-[#efebe2] px-3 py-1 text-[#5d5a53]">{item.submissions} submitted</span>
            {item.paid > 0 ? <span className="rounded-full bg-[#e2f3e4] px-3 py-1 text-[#1f6b34]">{item.paid} paid</span> : null}
          </div>
        </div>
        <div
          aria-hidden="true"
          style={cover(item.slug)}
          className={`hidden aspect-square w-[148px] shrink-0 rounded-[16px] transition-transform duration-300 group-hover:scale-[1.03] sm:block ${item.open ? "" : "opacity-60 saturate-50"}`}
        />
      </Link>
    </li>
  );
}

export default async function CalmDirection() {
  const { items, totals, paid, now } = await labData();
  const open = [...items.filter((i) => i.open)].sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  const ended = items.filter((i) => !i.open);

  return (
    <div className="min-h-screen bg-[#f6f2ea] bg-[radial-gradient(1200px_500px_at_15%_-10%,#ffe6c7_0,transparent_60%),radial-gradient(1000px_480px_at_95%_0%,#dfe6ff_0,transparent_60%)] bg-no-repeat text-[#1c1b19]">
      <div className="sticky top-4 z-10 flex justify-center px-4">
        <nav className="flex items-center gap-1 rounded-full bg-white/70 p-1.5 text-sm shadow-[0_8px_30px_-12px_rgba(28,27,25,0.3)] ring-1 ring-black/5 backdrop-blur-xl">
          <Link href="/lab/b" className={`px-4 text-lg ${SERIF}`}>
            Proofwork
          </Link>
          <Link href="/lab/b" className="rounded-full bg-[#1c1b19]/[0.06] px-4 py-2 font-medium">
            Bounties
          </Link>
          <Link href="/verify" className="rounded-full px-4 py-2 text-[#5d5a53] hover:text-[#1c1b19]">
            Verify
          </Link>
          <Link href="/custody" className="hidden rounded-full px-4 py-2 text-[#5d5a53] hover:text-[#1c1b19] sm:block">
            Custody
          </Link>
          <Link href="/campaigns" className="rounded-full bg-[#1c1b19] px-4 py-2 font-medium text-white">
            Sign in
          </Link>
        </nav>
      </div>

      <main className="mx-auto max-w-[820px] px-5 pb-32">
        <header className="pb-14 pt-24 text-center">
          <h1 className={`text-[clamp(44px,7vw,76px)] leading-[1.02] tracking-[-0.02em] ${SERIF}`}>
            Bounties a person
            <br />
            <em className="font-normal italic">actually reads.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-[#5d5a53]">
            The budget sits in escrow before a bounty opens. Post on X, send the link, and a reviewer decides.
          </p>
          <p className="mt-8 text-sm text-[#8a867d]">
            {plain(totals.paidAmount)} USDC paid · {totals.payouts} payouts · {totals.decisions} reviews on-chain
          </p>
        </header>

        <h2 className="pb-5 pl-[108px] text-sm font-medium text-[#8a867d] sm:pl-[172px]">Open, by closing date</h2>
        <ol className="relative before:absolute before:bottom-0 before:left-[105px] before:top-2 before:border-l before:border-dashed before:border-[#cfc9bb] sm:before:left-[145px]">
          {open.map((i) => (
            <Row key={i.id} item={i} />
          ))}
        </ol>

        {ended.length > 0 ? (
          <>
            <h2 className="pb-5 pl-[108px] pt-12 text-sm font-medium text-[#8a867d] sm:pl-[172px]">Ended</h2>
            <ol className="relative before:absolute before:bottom-0 before:left-[105px] before:top-2 before:border-l before:border-dashed before:border-[#cfc9bb] sm:before:left-[145px]">
              {ended.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </ol>
          </>
        ) : null}

        <section className="mt-20 rounded-[28px] bg-white/70 p-8 ring-1 ring-black/[0.04] backdrop-blur">
          <h2 className={`text-3xl ${SERIF}`}>Paid this week</h2>
          <ul className="mt-5 divide-y divide-[#ece7dc]">
            {paid.map((p) => (
              <li key={p.releaseTxHash}>
                <a href={publicEnv.explorerTxUrl(p.releaseTxHash)} target="_blank" rel="noreferrer" className="flex items-center gap-4 py-3.5 hover:opacity-70">
                  <span aria-hidden="true" style={cover(p.campaignSlug)} className="size-9 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{p.campaignTitle}</span>
                  <span className="text-sm text-[#8a867d]">{formatRelative(p.releasedAt, now)}</span>
                  <span className="w-24 text-right text-[15px] font-semibold tabular-nums">{plain(p.amount)} USDC</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
