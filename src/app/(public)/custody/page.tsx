import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MoneyFlow } from "@/components/site/money-flow";
import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";
import { funderLimits, sealedDualReviewEnabled } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { TX_FEE_FLOOR_XLM } from "@/domain/funding-readiness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Custody and fees",
  description: "Where a campaign budget sits, which keys can move it, what Proofwork can and cannot do, and what it costs.",
};

/** Trustless Work's protocol fee, charged by the escrow contract on every release and on the remainder. Measured in Month 2. */
const PROTOCOL_FEE = "0.3%";
const AUDIT_URL = "https://stellarsecurityportal.com";

/**
 * What a team is told before it puts money in: every statement here describes
 * what the escrow roles and the code enforce, not an intention.
 */
export default function CustodyPage() {
  const limits = funderLimits();
  const figures: Array<[label: string, value: string, unit?: string]> = [
    ["Trustless Work protocol fee, on every amount that leaves the escrow", PROTOCOL_FEE],
    ["Proofwork platform fee, fixed on the escrow when you deploy it", "0%"],
    [`Open ${limits.maxOpenCampaigns === 1 ? "campaign" : "campaigns"} per funder at a time`, String(limits.maxOpenCampaigns)],
    ["Open budget per funder", String(limits.maxOpenBudget), "USDC"],
  ];
  return (
    <div className="bg-canvas text-white">
      <section className="px-5 pb-20 pt-32 sm:px-6 md:pt-40">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">For teams funding a campaign</p>
          <h1 className={`mt-4 text-[clamp(3.4rem,10vw,8.5rem)] leading-[0.84] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            {["Custody", "and", "fees."].map((w, i) => (
              <span key={w} className="mr-[0.2em] inline-block overflow-y-clip -mt-[0.12em] pt-[0.12em] pb-[0.05em] align-top">
                <span className={cx("inline-block animate-rise", i === 2 && "text-accent")} style={{ animationDelay: `${80 + i * 80}ms` }}>
                  {w}
                </span>
              </span>
            ))}
          </h1>
          <p className="mt-6 max-w-2xl animate-reveal text-[17px] leading-relaxed text-white/65 [animation-delay:300ms]">
            Proofwork never holds your budget. It sits in an escrow contract that only your wallet can pay out from, on {publicEnv.networkName}. This
            page says exactly who can do what.
          </p>

          {/* Who can move the money, drawn. */}
          <MoneyFlow you className="mt-16 animate-reveal [animation-delay:450ms]" />

          {/* The figures as till-slip lines: what it costs and how much one funder can have open. */}
          <dl className="mt-16 max-w-4xl border-y-2 border-dashed border-white/25">
            {figures.map(([label, value, unit]) => (
              <div key={label} className="flex items-baseline gap-4 border-b border-dashed border-white/15 py-4 last:border-b-0 sm:py-5">
                <dt className="min-w-0 flex-1 text-[15px] leading-snug text-white/65 sm:flex-none sm:basis-auto">{label}</dt>
                <span aria-hidden="true" className="hidden min-w-8 flex-1 border-b border-dotted border-white/25 sm:block" />
                <dd className={`shrink-0 whitespace-nowrap text-right text-[clamp(1.9rem,3vw,2.5rem)] leading-none ${FONT}`} style={{ fontVariationSettings: axes(66, 900) }}>
                  {value}
                  {unit ? <span className="ml-1.5 font-sans text-sm font-semibold text-white/65 [font-variation-settings:normal]">{unit}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-paper px-5 py-20 text-paper-ink sm:px-6">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/60">The details</p>
          <ol className="mt-6 border-t-2 border-black">
            <Section n={1} title="Where the budget sits">
              <p>
                Each campaign has its own Trustless Work multi-release escrow, a Soroban smart contract. You deploy it and fund it from your wallet, in
                USDC issued by Circle. The budget goes from your wallet into that contract and never passes through a Proofwork account. The contract
                address is on the campaign page, and its balance is read from the chain, not from our database.
              </p>
            </Section>

            <Section n={2} title="What your wallet signs">
              <List
                items={[
                  ["Deploy and fund", "You create the escrow and move the budget into it."],
                  [
                    "Release",
                    "After a person has reviewed a submission and passed it, you pick the payouts and sign one release per contributor. No payout leaves the escrow without your signature.",
                  ],
                  ["Close", "At the deadline you close the campaign, which opens the return of what is left."],
                ]}
              />
              {sealedDualReviewEnabled() ? (
                <p className="mt-4">
                  One exception, which you choose yourself: a campaign created with founder-sealed review names Proofwork&apos;s founder wallet as the
                  release signer, so that wallet signs the releases instead of yours. The campaign form says so before you save.
                </p>
              ) : null}
            </Section>

            <Section n={3} title="What Proofwork can and cannot do">
              <List
                items={[
                  [
                    "Can",
                    "Add a payout line to the escrow for a submission that passed review, with the contributor's wallet and the campaign's reward, and mark it ready. These steps move no money.",
                  ],
                  [
                    "Cannot",
                    "Release a payout, withdraw the budget, or move any amount out of the escrow. A payout line pays nobody until you release it, and the release you sign names the wallet it pays.",
                  ],
                  [
                    "Return of the remainder",
                    "After you close, the dispute resolver key signs the return of the unspent budget. The transaction is built with your wallet as its only destination. Proofwork keeps that key in a wallet, never on a server, so the return is signed by a person and is not instant.",
                  ],
                ]}
              />
              <p className="mt-4">Every review decision is written to Stellar as its own transaction when it is made, so you can check each one before you release.</p>
            </Section>

            <Section n={4} title="Fees">
              <List
                items={[
                  [
                    `Trustless Work protocol fee: ${PROTOCOL_FEE}`,
                    "Taken by the escrow contract from every amount that leaves it: each payout and the returned remainder. A 10 USDC reward arrives as 9.97 USDC.",
                  ],
                  ["Proofwork platform fee: 0%", "The fee is a field of the escrow, fixed when you deploy it. It cannot be raised on an escrow that already exists."],
                  [
                    "Network fees",
                    `Paid in XLM by whoever signs. Deploying and funding cost a few hundredths of an XLM each; the app asks for ${TX_FEE_FLOOR_XLM} XLM free per transaction before it lets you sign.`,
                  ],
                ]}
              />
            </Section>

            <Section n={5} title="Limits">
              <p>
                One funder can have {limits.maxOpenCampaigns} {limits.maxOpenCampaigns === 1 ? "campaign" : "campaigns"} open at a time, and{" "}
                {limits.maxOpenBudget} USDC of open budget in total. A campaign counts from its escrow deploy until it is closed.
              </p>
            </Section>

            <Section n={6} title="What you should know before funding">
              <List
                items={[
                  [
                    "The escrow is Trustless Work's contract",
                    <>
                      Proofwork has deployed no contract of its own. The Trustless Work escrow platform was audited by Runtime Verification; the report is on
                      the{" "}
                      <a href={AUDIT_URL} target="_blank" rel="noreferrer" className="font-semibold underline decoration-black/30 underline-offset-4 hover:decoration-black">
                        Stellar Security Portal ↗
                      </a>
                      .
                    </>,
                  ],
                  ["There is no timer", "The remainder returns only after you close the campaign and the resolver signs. Nothing returns by itself at the deadline."],
                  ["The return depends on the resolver key", "If that key were lost, the unspent part of a closed campaign could not be returned. Payouts never depend on it."],
                  ["You are the one paying contributors", "Proofwork reviews and records. Who gets paid, and any obligation that comes with a reward, is yours."],
                ]}
              />
            </Section>
          </ol>
        </div>
      </section>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid gap-4 border-b border-black/15 py-10 md:grid-cols-[5rem_minmax(0,1fr)] md:gap-8">
      <span className={`text-[3.5rem] leading-[0.8] text-black/20 ${FONT}`} style={{ fontVariationSettings: axes(60, 900) }}>
        {String(n).padStart(2, "0")}
      </span>
      <div>
        <h2 className={`text-[clamp(1.8rem,3.2vw,2.6rem)] leading-[0.95] ${FONT}`} style={{ fontVariationSettings: axes(88, 850) }}>
          {title}
        </h2>
        <div className="mt-4 max-w-3xl text-[16px] leading-[1.65] text-black/75">{children}</div>
      </div>
    </li>
  );
}

function List({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid">
      {items.map(([term, body]) => (
        <div key={term} className="grid gap-1 border-t border-black/10 py-4 first:border-t-0 first:pt-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
          <dt className="font-semibold leading-snug text-black">{term}</dt>
          <dd>{body}</dd>
        </div>
      ))}
    </dl>
  );
}
