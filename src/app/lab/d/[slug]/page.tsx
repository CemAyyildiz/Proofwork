import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Lock, ScanEye, Send } from "lucide-react";
import { publicEnv } from "@/config/public-env";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { campaignFacts, campaignPayouts } from "@/services/public-directory";
import { publicCampaign } from "@/services/submission";
import { plain } from "../../data";
import { DISPLAY, PAPER, Perforation, Slots, TopBar } from "../parts";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Send, title: "Post on X", body: "Follow the brief below. Original posts only." },
  { icon: ScanEye, title: "A person reviews it", body: "Scored against the rubric. The decision is written on-chain." },
  { icon: Lock, title: "Paid from escrow", body: "A pass releases the reward to your Stellar wallet." },
] as const;

export default async function LedgerCampaign({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await publicCampaign(slug);
  if (!c) notFound();
  const now = new Date();
  const [facts, payouts] = await Promise.all([campaignFacts(c.id), campaignPayouts(c.id)]);
  const reward = plain(c.rewardAmount);
  const team = facts.team ?? "Independent";

  return (
    <div className="min-h-screen text-[#111]" style={{ backgroundColor: PAPER }}>
      <TopBar />
      <main className="mx-auto max-w-[1240px] px-6 pb-28">
        <Link href="/lab/d" className="mt-8 inline-flex items-center gap-1.5 text-sm text-black/55 hover:text-black">
          <ArrowLeft className="size-4" /> All bounties
        </Link>

        <div className="mt-6 grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <p className="text-sm text-black/55">
              {team} · {c.open ? `closes ${formatRelative(c.deadlineAt, now)}` : "ended"}
            </p>
            <h1 className={`mt-3 text-[clamp(36px,5vw,64px)] font-bold leading-[0.98] ${DISPLAY}`}>{c.title}</h1>

            <ol className="mt-10 grid gap-3 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl bg-white p-5 ring-1 ring-black/[0.06]">
                  <div className="flex items-center justify-between">
                    <s.icon className="size-5" />
                    <span className="font-mono text-xs text-black/40">0{i + 1}</span>
                  </div>
                  <p className="mt-4 font-semibold">{s.title}</p>
                  <p className="mt-1 text-sm text-black/60">{s.body}</p>
                </li>
              ))}
            </ol>

            <h2 className={`mt-14 text-2xl font-bold ${DISPLAY}`}>The brief</h2>
            <p className="mt-4 max-w-2xl whitespace-pre-line text-[17px] leading-relaxed text-black/75">{c.brief}</p>

            <div className="mt-14 flex items-baseline justify-between">
              <h2 className={`text-2xl font-bold ${DISPLAY}`}>Paid so far</h2>
              <span className="font-mono text-xs uppercase tracking-wider text-black/55">{payouts.length} payouts · each one checkable</span>
            </div>
            {payouts.length === 0 ? (
              <p className="mt-4 text-black/60">No payout yet. The first one appears here with its transaction.</p>
            ) : (
              <ul className="mt-4 rounded-2xl bg-white px-5 font-mono text-[13px] ring-1 ring-black/[0.06]">
                {payouts.map((p, i) => (
                  <li key={p.releaseTxHash} className={i > 0 ? "border-t border-dashed border-black/15" : ""}>
                    <a href={publicEnv.explorerTxUrl(p.releaseTxHash)} target="_blank" rel="noreferrer" className="flex items-baseline gap-3 py-3 hover:text-black">
                      <span className="text-black/45">#{p.shortId}</span>
                      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-black/25">{".".repeat(120)}</span>
                      <span className="text-black/50">{formatRelative(p.releasedAt, now)}</span>
                      <span className="text-black/50 underline decoration-black/20 underline-offset-4">{truncateMiddle(p.releaseTxHash, 4, 4)}</span>
                      <span className="w-16 text-right font-semibold text-[#0a7d3b]">+{plain(p.amount)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="relative overflow-hidden rounded-3xl bg-black text-white">
              <div className="p-7">
                <p className="font-mono text-[11px] uppercase tracking-wider text-white/55">Reward per approved post</p>
                <p className={`mt-2 text-7xl font-bold leading-none ${DISPLAY}`}>
                  {reward}
                  <span className="ml-2 text-xl font-medium text-white/55">USDC</span>
                </p>
                <div className="mt-7">
                  <Slots budget={plain(c.budget)} reward={reward} paid={facts.paid} dark />
                </div>
              </div>
              <div className="relative border-t border-dashed border-white/25 p-7">
                <span aria-hidden="true" className="absolute -left-3 -top-3 size-6 rounded-full" style={{ backgroundColor: PAPER }} />
                <span aria-hidden="true" className="absolute -right-3 -top-3 size-6 rounded-full" style={{ backgroundColor: PAPER }} />
                <dl className="grid grid-cols-2 gap-5 text-sm">
                  <div>
                    <dt className="text-white/55">{c.open ? "Closes" : "Closed"}</dt>
                    <dd className="mt-1 font-semibold">{formatDateShort(c.deadlineAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/55">Submitted</dt>
                    <dd className="mt-1 font-semibold">{facts.submissions} posts</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-white/55">Budget held in escrow</dt>
                    <dd className="mt-1 font-semibold">
                      {plain(c.budget)} USDC
                      {c.escrowContractId ? (
                        <a href={publicEnv.explorerContractUrl(c.escrowContractId)} target="_blank" rel="noreferrer" className="ml-2 font-mono text-xs font-normal text-[#fdda24] underline underline-offset-4">
                          {truncateMiddle(c.escrowContractId, 4, 4)}
                        </a>
                      ) : null}
                    </dd>
                  </div>
                </dl>
                {c.open ? (
                  <Link href={`/c/${c.slug}#submit`} className="mt-7 flex items-center justify-between rounded-full bg-[#fdda24] py-2 pl-6 pr-2 font-semibold text-black hover:bg-[#ffe55c]">
                    Submit your post
                    <span className="grid size-10 place-items-center rounded-full bg-black text-[#fdda24]">
                      <ArrowRight className="size-5" />
                    </span>
                  </Link>
                ) : (
                  <p className="mt-7 rounded-full bg-white/10 py-3 text-center text-sm">This bounty has ended</p>
                )}
              </div>
            </div>
            <div className="relative mt-4 bg-white px-6 py-5 text-sm">
              <Perforation side="top" />
              <p className="font-semibold">Proofwork never holds the budget.</p>
              <p className="mt-1 text-black/60">
                It sits in an escrow contract until a reviewer passes a post.{" "}
                <Link href="/custody" className="text-black underline underline-offset-4">
                  How custody works
                </Link>
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
