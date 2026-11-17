import type { Metadata } from "next";
import type { ReactNode } from "react";
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

/** Dashes running from one box to the next: the direction money can move. Static under reduced motion. */
function Flow({ label, vertical = false }: { label: string; vertical?: boolean }) {
  const strip = (
    <div className="h-1 w-full overflow-hidden">
      <div
        aria-hidden="true"
        className="h-1 w-[200%] animate-marquee"
        style={{ animationDuration: "6s", animationDirection: "reverse", background: "repeating-linear-gradient(90deg,#fdda24 0 10px,transparent 10px 20px)" }}
      />
    </div>
  );
  return (
    <div className={cx("relative flex items-center justify-center", vertical ? "h-20 w-full" : "min-w-16 flex-1")}>
      {vertical ? <div className="w-20 rotate-90">{strip}</div> : strip}
      <span className="absolute whitespace-nowrap rounded-full bg-canvas px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/60">{label}</span>
    </div>
  );
}

function Node({ kicker, title, body, tone = "dark" }: { kicker: string; title: string; body: string; tone?: "dark" | "yellow" }) {
  return (
    <div className={cx("w-full rounded-[26px] p-6 md:w-[17rem] md:shrink-0", tone === "yellow" ? "bg-accent text-black" : "border border-white/10 bg-[#111] text-white")}>
      <p className={cx("font-mono text-[10.5px] uppercase tracking-[0.18em]", tone === "yellow" ? "text-black/60" : "text-white/45")}>{kicker}</p>
      <p className={`mt-2 text-[1.7rem] leading-none ${FONT}`} style={{ fontVariationSettings: axes(88, 850) }}>
        {title}
      </p>
      <p className={cx("mt-3 text-sm leading-relaxed", tone === "yellow" ? "text-black/75" : "text-white/60")}>{body}</p>
    </div>
  );
}

/**
 * What a team is told before it puts money in: every statement here describes
 * what the escrow roles and the code enforce, not an intention.
 */
export default function CustodyPage() {
  const limits = funderLimits();
  const figures: Array<[string, string, boolean]> = [
    [PROTOCOL_FEE, "Trustless Work protocol fee, on every amount that leaves the escrow", false],
    ["0%", "Proofwork platform fee, fixed on the escrow when you deploy it", true],
    [String(limits.maxOpenCampaigns), `open ${limits.maxOpenCampaigns === 1 ? "campaign" : "campaigns"} per funder at a time`, false],
    [String(limits.maxOpenBudget), "USDC of open budget per funder", false],
  ];
  return (
    <div className="bg-canvas text-white">
      <section className="px-5 pb-20 pt-32 sm:px-6 md:pt-40">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">For teams funding a campaign</p>
          <h1 className={`mt-4 text-[clamp(3.4rem,10vw,8.5rem)] leading-[0.84] ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
            {["Custody", "and", "fees."].map((w, i) => (
              <span key={w} className="mr-[0.2em] inline-block overflow-y-clip pb-[0.05em] align-top">
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
          <figure className="mt-16 animate-reveal [animation-delay:450ms]" aria-label="How the budget moves">
            <div className="flex flex-col items-stretch md:flex-row md:items-stretch">
              <Node kicker="Funder" title="Your wallet" body="Deploys and funds the escrow. Signs every release." />
              <div className="flex md:flex-1">
                <span className="contents md:hidden">
                  <Flow label="Fund" vertical />
                </span>
                <span className="hidden md:contents">
                  <Flow label="Fund" />
                </span>
              </div>
              <Node tone="yellow" kicker="Trustless Work escrow" title="The contract" body="Holds the budget. Its balance is read from the chain, not from our database." />
              <div className="flex md:flex-1">
                <span className="contents md:hidden">
                  <Flow label="Release, you sign" vertical />
                </span>
                <span className="hidden md:contents">
                  <Flow label="Release, you sign" />
                </span>
              </div>
              <Node kicker="Contributors" title="Their wallets" body="Paid one release per approved post, to the wallet the release names." />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-[26px] border border-dashed border-white/20 p-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/45">Proofwork keys</p>
                <p className="mt-2 text-white/75">Add a payout line for a passed post and write each decision to Stellar.</p>
                <p className="mt-2 font-semibold text-fail">Cannot release, withdraw or move any amount.</p>
              </div>
              <div className="rounded-[26px] border border-dashed border-white/20 p-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/45">Dispute resolver</p>
                <p className="mt-2 text-white/75">After you close, signs the return of what is left.</p>
                <p className="mt-2 font-semibold text-accent">Only to your wallet.</p>
              </div>
            </div>
          </figure>

          <dl className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {figures.map(([value, label, accent]) => (
              <div key={label} className="flex flex-col-reverse justify-end rounded-[26px] border border-white/10 p-6">
                <dt className="mt-3 text-sm leading-snug text-white/55">{label}</dt>
                <dd className={cx(`text-[clamp(3.2rem,6vw,5rem)] leading-[0.82] ${FONT}`, accent && "text-accent")} style={{ fontVariationSettings: axes(62, 900) }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="bg-paper px-5 py-20 text-paper-ink sm:px-6">
        <div className="mx-auto max-w-4xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">The details</p>
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
        <div className="mt-4 text-[16px] leading-[1.65] text-black/75">{children}</div>
      </div>
    </li>
  );
}

function List({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-5">
      {items.map(([term, body]) => (
        <div key={term} className="border-l-2 border-black/15 pl-4">
          <dt className="font-semibold text-black">{term}</dt>
          <dd className="mt-1">{body}</dd>
        </div>
      ))}
    </dl>
  );
}
