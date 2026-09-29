import type { Metadata } from "next";
import Link from "next/link";
import { stageOf, type Stage } from "@/components/contributor-state";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pill, type PillTone } from "@/components/ui/pill";
import { formatDateShort, formatUsdc } from "@/lib/format";
import { listPublicCampaigns } from "@/services/submission";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open bounties",
  description: "Escrow-funded bounties on Stellar testnet. Do the task, get reviewed by a person, get paid in USDC.",
};

const STAGE_PILL: Record<Stage, { tone: PillTone; label: string }> = {
  open: { tone: "pass", label: "Open" },
  closed: { tone: "wait", label: "Closed" },
  ended: { tone: "wait", label: "Deadline passed" },
  unfunded: { tone: "wait", label: "Not funded yet" },
};

const HOW = [
  { title: "Do the task", body: "Read the brief and post on X. No wallet needed to look around." },
  { title: "Submit the link", body: "Connect a Stellar testnet wallet and paste your post's link." },
  { title: "Get reviewed and paid", body: "A person scores it; a pass is paid from escrow in testnet USDC." },
] as const;

/** Public campaign directory: no wallet needed to browse; one is asked for only on submit. */
export default async function ExplorePage() {
  const list = await listPublicCampaigns();

  return (
    <div className="mx-auto max-w-[1180px] pb-24 pt-4 md:pt-6">
      <Eyebrow>Campaigns</Eyebrow>
      <h1 className="mt-4 text-[clamp(36px,4.6vw,60px)] font-semibold leading-[0.98] tracking-[-0.05em]">Open bounties</h1>
      <p className="mt-4 max-w-[560px] text-[17px] leading-[1.55] text-text-2">
        Every campaign here is funded into escrow on Stellar testnet before it opens. Pick one, do the task, and connect a wallet
        only when you submit.
      </p>

      {list.length === 0 ? (
        <Card className="mt-10 p-8 text-center">
          <p className="text-lg font-semibold tracking-[-0.02em]">No live campaigns yet.</p>
          <p className="mt-2 text-sm text-text-2">The first campaign appears here as soon as its budget is in escrow.</p>
        </Card>
      ) : (
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {list.map((c) => {
            const pill = STAGE_PILL[stageOf(c)];
            return (
              <li key={c.id}>
                <Link
                  href={`/c/${c.slug}`}
                  className="group block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Card className="flex h-full flex-col p-6 transition-colors duration-200 group-hover:border-line-strong">
                    <div className="flex items-center justify-between gap-3">
                      <Pill tone={pill.tone}>{pill.label}</Pill>
                      <span className="font-mono text-[12px] text-muted">closes {formatDateShort(c.deadlineAt)}</span>
                    </div>
                    <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-[-0.03em] [overflow-wrap:anywhere]">{c.title}</h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-normal text-text-2">{c.brief}</p>
                    <dl className="mt-auto flex flex-wrap gap-x-6 gap-y-2 pt-5 text-sm">
                      <div>
                        <dt className="text-muted">Reward</dt>
                        <dd className="font-medium text-accent">{formatUsdc(c.rewardAmount)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Budget</dt>
                        <dd className="font-medium">{formatUsdc(c.budget)}</dd>
                      </div>
                    </dl>
                    <span className="mt-5 text-sm font-medium text-text group-hover:text-accent">
                      View campaign <span aria-hidden="true">→</span>
                    </span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ol className="mt-10 grid gap-3 text-sm sm:grid-cols-3">
        {HOW.map((step, i) => (
          <li key={step.title} className="rounded-lg border border-line bg-surface px-4 py-3.5">
            <span className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted">{String(i + 1).padStart(2, "0")}</span>
            <p className="mt-1 font-semibold">{step.title}</p>
            <p className="mt-1 text-[13px] leading-normal text-text-2">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
