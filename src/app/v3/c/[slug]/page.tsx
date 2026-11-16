import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check, ChevronLeft, Clock, ExternalLink, Lock, ShieldCheck, Users } from "lucide-react";
import { stageOf } from "@/components/contributor-state";
import { Badge } from "@/components/shad/badge";
import { Button } from "@/components/shad/button";
import { Card, CardContent } from "@/components/shad/card";
import { Progress } from "@/components/shad/progress";
import { Separator } from "@/components/shad/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shad/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shad/tabs";
import { plainAmount, TeamAvatar, Usdc, UsdcIcon } from "@/components/v3/bits";
import { publicEnv } from "@/config/public-env";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { campaignFacts, campaignPayouts } from "@/services/public-directory";
import { publicCampaign } from "@/services/submission";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Connect your Stellar wallet", body: "The reward is paid to this wallet. New wallet? The page helps you set it up." },
  { title: "Sign in with X", body: "So only the account that wrote the post can submit it." },
  { title: "Paste the link to your post", body: "One post per wallet. You can follow its review here." },
] as const;

export default async function CampaignV3({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await publicCampaign(slug);
  if (!c) notFound();
  const now = new Date();
  const [facts, paid] = await Promise.all([campaignFacts(c.id), campaignPayouts(c.id)]);
  const stage = stageOf(c);
  const open = stage === "open";
  const paidAmount = paid.reduce((sum, p) => sum + Number(p.amount), 0);
  const left = Math.max(0, Number(c.budget) - paidAmount);
  const team = facts.team ?? "Campaign";

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mt-5 text-muted-foreground">
        <Link href="/v3/explore">
          <ChevronLeft className="size-4" />
          All bounties
        </Link>
      </Button>

      <header className="mt-3 flex flex-wrap items-start gap-4 pb-8">
        <TeamAvatar name={team} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{c.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {facts.team ? (
              <span>
                by <span className="font-medium text-foreground">{facts.team}</span>
              </span>
            ) : null}
            <Badge variant="secondary" className={open ? "bg-success-soft text-success" : ""}>
              {open ? "Submissions open" : stage === "closed" ? "Closed" : stage === "ended" ? "Deadline passed" : "Not funded yet"}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4" />
              {facts.submissions} {facts.submissions === 1 ? "submission" : "submissions"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4" />
              Reviewed by a person
            </span>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-20">
          <Card className="gap-0 py-0">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Reward per approved post</p>
              <Usdc amount={plainAmount(c.rewardAmount)} className="mt-1 text-3xl tracking-tight" iconClassName="size-7" />
              <p className="mt-1.5 text-xs text-muted-foreground">
                You receive it net of the 0.3% escrow fee.{publicEnv.isMainnet ? "" : " Testnet USDC, not real money."}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5" />
                    {open ? "Closes" : "Ended"}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">{open ? formatRelative(c.deadlineAt, now) : formatDateShort(c.closedAt ?? c.deadlineAt).split(" · ")[0]}</p>
                </div>
                <div className="rounded-lg bg-muted px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="size-3.5" />
                    Paid so far
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {paid.length} {paid.length === 1 ? "contributor" : "contributors"}
                  </p>
                </div>
              </div>

              <Button asChild size="lg" className="mt-5 w-full" disabled={!open}>
                <Link href={`/c/${c.slug}#submit`}>{open ? "Submit your post" : "Submissions are closed"}</Link>
              </Button>
            </CardContent>
            <Separator />
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Lock className="size-4" />
                  Budget in escrow
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {plainAmount(String(left))} of {plainAmount(c.budget)} USDC left
                </span>
              </div>
              <Progress value={Math.min(100, (paidAmount / Number(c.budget)) * 100)} className="mt-3 h-2" />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Proofwork cannot move this money. Only the funder releases payouts.{" "}
                {c.escrowContractId ? (
                  <a href={publicEnv.explorerContractUrl(c.escrowContractId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4">
                    See the contract
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </p>
            </CardContent>
          </Card>

          {open ? (
            <Card className="gap-0 py-0">
              <CardContent className="p-5">
                <p className="text-sm font-semibold">How to submit</p>
                <ol className="mt-4 space-y-4">
                  {STEPS.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium leading-6">{s.title}</p>
                        <p className="text-[13px] text-muted-foreground">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </aside>

        <Tabs defaultValue="details" className="min-w-0 gap-6">
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="details" className="flex-none px-4">Details</TabsTrigger>
            <TabsTrigger value="review" className="flex-none px-4">How it&apos;s reviewed</TabsTrigger>
            <TabsTrigger value="payouts" className="flex-none gap-1.5 px-4">
              Payouts
              <span className="text-xs tabular-nums text-muted-foreground">{paid.length}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <h2 className="text-lg font-semibold">The task</h2>
            <p className="mt-3 max-w-[680px] whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">{c.brief}</p>
            <div className="mt-8 grid max-w-[680px] gap-3 sm:grid-cols-3">
              {[
                ["Where", "A public post on X"],
                ["Who can submit", "The account that wrote the post"],
                ["Limit", "One post per wallet"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">{k}</p>
                  <p className="mt-0.5 text-sm font-medium">{v}</p>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="review">
            <h2 className="text-lg font-semibold">
              A person answers six questions. {PASS_THRESHOLD} yes out of {SIGNALS.length} passes.
            </h2>
            <ol className="mt-4 max-w-[680px] overflow-hidden rounded-xl border bg-card">
              {SIGNALS.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                  {s.label}
                </li>
              ))}
            </ol>
            <p className="mt-4 max-w-[680px] text-sm leading-relaxed text-muted-foreground">
              The decision and its reason are written to Stellar when they are made, so anyone can check them. If you are rejected you can ask for one
              re-review. The funder gives the final approval before a payout.
            </p>
          </TabsContent>

          <TabsContent value="payouts">
            {paid.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">No payout yet. The first one shows up here with its transaction.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Submission</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Review</TableHead>
                      <TableHead className="pr-4 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paid.map((p) => (
                      <TableRow key={p.releaseTxHash}>
                        <TableCell className="pl-4 font-mono text-[13px]">{p.shortId}</TableCell>
                        <TableCell className="text-muted-foreground">{formatRelative(p.releasedAt, now)}</TableCell>
                        <TableCell>
                          {p.decisionId ? (
                            <Link href={`/verify/${p.decisionId}`} className="font-medium underline underline-offset-4">
                              Check the decision
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-4">
                          <a
                            href={publicEnv.explorerTxUrl(p.releaseTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-end gap-2"
                            title={`Transaction ${truncateMiddle(p.releaseTxHash, 6, 6)}`}
                          >
                            <UsdcIcon className="size-4" />
                            <span className="font-semibold tabular-nums">{plainAmount(p.amount)}</span>
                            <ArrowUpRight className="size-3.5 text-muted-foreground" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
