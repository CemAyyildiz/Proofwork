import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
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
  return (
    <div className="mx-auto max-w-[860px] pb-24 pt-4 md:pt-6">
      <Eyebrow>For teams funding a campaign</Eyebrow>
      <h1 className="mt-4 text-[clamp(36px,4.6vw,60px)] font-semibold leading-[0.98] tracking-[-0.05em]">Custody and fees</h1>
      <p className="mt-4 max-w-[640px] text-[17px] leading-[1.55] text-text-2">
        Proofwork never holds your budget. It sits in an escrow contract that only your wallet can pay out from, on{" "}
        {publicEnv.networkName}. This page says exactly who can do what.
      </p>

      <div className="mt-10 grid gap-4">
        <Section title="Where the budget sits">
          <p>
            Each campaign has its own Trustless Work multi-release escrow, a Soroban smart contract. You deploy it and fund it from your
            wallet, in USDC issued by Circle. The budget goes from your wallet into that contract and never passes through a Proofwork
            account. The contract address is on the campaign page, and its balance is read from the chain, not from our database.
          </p>
        </Section>

        <Section title="What your wallet signs">
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
              One exception, which you choose yourself: a campaign created with founder-sealed review names Proofwork&apos;s founder wallet as
              the release signer, so that wallet signs the releases instead of yours. The campaign form says so before you save.
            </p>
          ) : null}
        </Section>

        <Section title="What Proofwork can and cannot do">
          <List
            items={[
              [
                "Can",
                "Add a payout line to the escrow for a submission that passed review, with the contributor's wallet and the campaign's reward, and mark it ready. These steps move no money.",
              ],
              ["Cannot", "Release a payout, withdraw the budget, or move any amount out of the escrow. A payout line pays nobody until you release it, and the release you sign names the wallet it pays."],
              [
                "Return of the remainder",
                "After you close, the dispute resolver key signs the return of the unspent budget. The transaction is built with your wallet as its only destination. Proofwork keeps that key in a wallet, never on a server, so the return is signed by a person and is not instant.",
              ],
            ]}
          />
          <p className="mt-4">
            Every review decision is written to Stellar as its own transaction when it is made, so you can check each one before you release.
          </p>
        </Section>

        <Section title="Fees">
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

        <Section title="Limits">
          <p>
            One funder can have {limits.maxOpenCampaigns} {limits.maxOpenCampaigns === 1 ? "campaign" : "campaigns"} open at a time, and{" "}
            {limits.maxOpenBudget} USDC of open budget in total. A campaign counts from its escrow deploy until it is closed.
          </p>
        </Section>

        <Section title="What you should know before funding">
          <List
            items={[
              [
                "The escrow is Trustless Work's contract",
                <>
                  Proofwork has deployed no contract of its own. The Trustless Work escrow platform was audited by Runtime Verification; the
                  report is on the{" "}
                  <a href={AUDIT_URL} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
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
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-6 md:p-8">
      <h2 className="text-[22px] font-semibold tracking-[-0.03em]">{title}</h2>
      <div className="mt-3 text-[15px] leading-[1.6] text-text-2">{children}</div>
    </Card>
  );
}

function List({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-4">
      {items.map(([term, body]) => (
        <div key={term}>
          <dt className="font-semibold text-text">{term}</dt>
          <dd className="mt-1">{body}</dd>
        </div>
      ))}
    </dl>
  );
}
