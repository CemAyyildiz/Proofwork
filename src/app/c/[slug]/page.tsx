import Link from "next/link";
import { notFound } from "next/navigation";
import { AppealButton } from "@/components/appeal-button";
import { SubmitForm } from "@/components/submit-form";
import { publicEnv } from "@/config/public-env";
import { escrow } from "@/escrow";
import { currentUser } from "@/lib/current-user";
import { log } from "@/lib/logger";
import { mySubmission, publicCampaign } from "@/services/submission";

export const dynamic = "force-dynamic";

/** Contributor-facing campaign page: brief, live escrow balance, submit, own status. */
export default async function ContributorCampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await publicCampaign(slug);
  if (!c) notFound();

  let balance: string | null = null;
  if (c.escrowContractId) {
    try {
      balance = (await escrow.getEscrow(c.escrowContractId)).balance;
    } catch (e) {
      log.warn("escrow balance read failed", { slug, err: e instanceof Error ? e.message : String(e) });
    }
  }

  const user = await currentUser();
  const mine = user ? await mySubmission(c.id, user.pubkey) : null;
  const latest = mine?.decisions.at(-1) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-neutral-500">
          {c.rewardAmount} USDC per approved submission (net of 0.3% protocol fee) · deadline {c.deadlineAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      </div>

      <section className="rounded border border-neutral-200 p-4 text-sm">
        <h2 className="mb-1 font-medium">Is the money really there?</h2>
        {c.escrowContractId ? (
          <p>
            Escrow <code className="text-xs">{c.escrowContractId.slice(0, 8)}…</code> holds{" "}
            <strong>{balance ?? "?"} USDC</strong>.{" "}
            <a className="underline" href={publicEnv.explorerAccountUrl(c.escrowContractId)} target="_blank" rel="noreferrer">
              Check on-chain
            </a>
            . The platform cannot move it; only the funder can release, only a neutral resolver can return the remainder.
          </p>
        ) : (
          <p className="text-neutral-600">Escrow not deployed yet.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">The task</h2>
        <p className="whitespace-pre-wrap text-sm">{c.brief}</p>
        <p className="text-xs text-neutral-500">
          Every submission is scored against six yes/no signals: genuine account, original content, task actually done,
          follows the brief, one person one account, not spam. Four of six passes the rubric; the funder gives final approval.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Your submission</h2>
        {!user ? (
          <p className="text-sm text-neutral-600">Connect your Stellar wallet (top right) to submit. Rewards are paid to that wallet in USDC; it needs a USDC trustline.</p>
        ) : mine ? (
          <div className="space-y-2 text-sm">
            <p>
              <a className="underline" href={mine.submission.workUrl} target="_blank" rel="noreferrer">{mine.submission.workUrl}</a>
              <span className="ml-2 text-neutral-500">status: {mine.submission.status}</span>
            </p>
            {latest ? (
              <p>
                Decision: <strong>{latest.outcome}</strong> ({latest.reasonCode})
                {latest.txHash ? (
                  <>
                    {" · "}
                    <Link className="underline" href={`/verify/${latest.id}`}>verify on-chain</Link>
                  </>
                ) : null}
              </p>
            ) : (
              <p className="text-neutral-500">Awaiting review.</p>
            )}
            {latest ? <p className="text-neutral-700">{latest.note}</p> : null}
            {mine.submission.status === "rejected" && mine.decisions.length < 2 && c.open ? (
              <AppealButton submissionId={mine.submission.id} />
            ) : null}
            {mine.submission.status === "appealed" ? <p className="text-neutral-500">Re-review requested.</p> : null}
          </div>
        ) : c.open ? (
          <SubmitForm campaignSlug={c.slug} />
        ) : (
          <p className="text-sm text-neutral-600">{c.closedAt ? "This campaign is closed." : "This campaign is not accepting submissions."}</p>
        )}
      </section>
    </div>
  );
}
