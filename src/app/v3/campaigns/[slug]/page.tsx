import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft, Copy, ExternalLink } from "lucide-react";
import { Badge } from "@/components/shad/badge";
import { Button } from "@/components/shad/button";
import { Card, CardContent } from "@/components/shad/card";
import { Progress } from "@/components/shad/progress";
import { plainAmount, TeamAvatar } from "@/components/v3/bits";
import { SubmissionsTable, type RowState, type TableRowData } from "@/components/v3/submissions-table";
import { describeStep, OWNER_LABEL, stageLabel } from "@/components/workspace/campaign-phase";
import { publicEnv } from "@/config/public-env";
import { campaignStage, countSubmissions, isReadyToPay, nextStep } from "@/domain/campaign-status";
import { reasonLabel } from "@/domain/rubric";
import { currentUser } from "@/lib/current-user";
import { formatDateShort, formatRelative } from "@/lib/format";
import { canManageCampaign } from "@/services/access";
import { getCampaignBySlug } from "@/services/campaign";
import { submissionsForFunder } from "@/services/payout";
import { campaignFacts } from "@/services/public-directory";

export const dynamic = "force-dynamic";

/** "builder12" from https://x.com/builder12/status/…; the link was validated when it was stored. */
function handleOf(workUrl: string): string {
  return new URL(workUrl).pathname.split("/")[1] ?? "post";
}

export default async function FunderCampaignV3({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await getCampaignBySlug(slug);
  if (!c) notFound();
  const user = await currentUser(c.id);
  if (!user || !canManageCampaign(c, user)) notFound();
  const now = new Date();
  const [subs, facts] = await Promise.all([submissionsForFunder(c.id), campaignFacts(c.id)]);
  const counts = countSubmissions(subs.map((r) => ({ status: r.submission.status, payoutStatus: r.payout?.status ?? null, payoutAmount: r.payout?.amount ?? null })));
  const stage = campaignStage(c, counts, now);
  const step = nextStep(stage, c, counts, now);
  const next = describeStep(step, c);

  const rows: TableRowData[] = subs.map((r) => {
    const row = { status: r.submission.status, payoutStatus: r.payout?.status ?? null };
    const state: RowState =
      row.payoutStatus === "released"
        ? "paid"
        : row.payoutStatus === "approved"
          ? "signature"
          : isReadyToPay(row)
            ? "ready"
            : r.submission.status === "rejected"
              ? "rejected"
              : "review";
    const failed = r.latest && r.latest.reasonCode !== "R00_PASS" ? reasonLabel(r.latest.reasonCode).split(" · ")[1] ?? null : null;
    return {
      id: r.submission.id,
      shortId: r.submission.shortId,
      workUrl: r.submission.workUrl,
      handle: handleOf(r.submission.workUrl),
      wallet: r.submission.contributorPubkey,
      walletUrl: publicEnv.explorerAccountUrl(r.submission.contributorPubkey),
      submitted: formatRelative(r.submission.submittedAt, now),
      state,
      reason: failed,
      note: r.latest?.note ?? null,
      decisionId: r.latest?.id ?? null,
      txUrl: r.payout?.releaseTxHash ? publicEnv.explorerTxUrl(r.payout.releaseTxHash) : null,
    };
  });

  const paid = Number(counts.paidAmount);
  const budget = Number(c.budget);
  const stats = [
    { label: "Budget in escrow", value: `${plainAmount(String(Math.max(0, budget - paid)))} USDC`, sub: `of ${plainAmount(c.budget)} USDC` },
    { label: "Paid out", value: `${plainAmount(counts.paidAmount)} USDC`, sub: `${counts.paid} ${counts.paid === 1 ? "contributor" : "contributors"}` },
    { label: "In review", value: String(counts.inReview), sub: "waiting for the reviewer" },
    { label: "Ready to pay", value: String(counts.readyToPay), sub: "passed, waiting for you" },
  ];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mt-5 text-muted-foreground">
        <Link href="/campaigns">
          <ChevronLeft className="size-4" />
          Campaigns
        </Link>
      </Button>

      <header className="mt-3 flex flex-wrap items-center gap-4">
        <TeamAvatar name={facts.team ?? c.title} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
            <Badge variant="secondary">{stageLabel(stage)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {plainAmount(c.rewardAmount)} USDC per approved post · closes {formatDateShort(c.deadlineAt).split(" · ")[0]} ({formatRelative(c.deadlineAt, now)})
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Copy className="size-4" />
            Copy contributor link
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/v3/c/${c.slug}`}>
              Public page
              <ExternalLink className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <Card className="mt-6 gap-0 border-foreground/15 bg-[#fffbe6] py-0">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Next step{step.owner ? ` · ${OWNER_LABEL[step.owner]}` : ""}
            </p>
            <p className="mt-0.5 text-lg font-semibold">{next.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{next.body}</p>
          </div>
          {step.owner === "funder" ? (
            <Button className="rounded-full">
              {next.title}
              <ArrowRight className="size-4" />
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Card key={s.label} className="gap-0 py-0">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
              {i === 0 ? <Progress value={budget === 0 ? 0 : Math.min(100, (paid / budget) * 100)} className="mt-3 h-1.5" /> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Submissions</h2>
      <SubmissionsTable rows={rows} reward={plainAmount(c.rewardAmount)} />
    </>
  );
}
