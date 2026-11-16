"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, CircleCheck, CircleDashed, CircleX, Clock3, ExternalLink, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/shad/badge";
import { Button } from "@/components/shad/button";
import { Checkbox } from "@/components/shad/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/shad/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shad/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/shad/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shad/tooltip";

export type RowState = "review" | "ready" | "signature" | "paid" | "rejected";

export interface TableRowData {
  id: string;
  shortId: string;
  workUrl: string;
  /** "builder12" from the post link, shown as the author. */
  handle: string;
  wallet: string;
  walletUrl: string;
  submitted: string;
  state: RowState;
  reason: string | null;
  note: string | null;
  decisionId: string | null;
  txUrl: string | null;
}

const STATE: Record<RowState, { label: string; icon: typeof Clock3; className: string }> = {
  review: { label: "In review", icon: Clock3, className: "text-muted-foreground" },
  ready: { label: "Passed, ready to pay", icon: CircleDashed, className: "text-foreground" },
  signature: { label: "Awaiting your signature", icon: CircleDashed, className: "text-foreground" },
  paid: { label: "Paid", icon: CircleCheck, className: "text-success" },
  rejected: { label: "Rejected", icon: CircleX, className: "text-destructive" },
};

const FILTERS: Array<{ id: RowState | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "review", label: "In review" },
  { id: "ready", label: "Ready to pay" },
  { id: "signature", label: "To sign" },
  { id: "paid", label: "Paid" },
  { id: "rejected", label: "Rejected" },
];

export function SubmissionsTable({ rows, reward }: { rows: TableRowData[]; reward: string }) {
  const [filter, setFilter] = useState<RowState | "all">(rows.some((r) => r.state === "ready") ? "ready" : "all");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const shown = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.state === filter)), [rows, filter]);
  const payable = shown.filter((r) => r.state === "ready");
  const count = (f: RowState | "all") => (f === "all" ? rows.length : rows.filter((r) => r.state === f).length);
  const allPicked = payable.length > 0 && payable.every((r) => picked.has(r.id));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as RowState | "all")}>
          <TabsList className="h-auto flex-wrap">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
                {f.label}
                <span className="text-xs tabular-nums text-muted-foreground">{count(f.id)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm">
          Download review log
        </Button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Select every submission that is ready to pay"
                  checked={allPicked}
                  disabled={payable.length === 0}
                  onCheckedChange={(v) => setPicked(v ? new Set(payable.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Post</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review note</TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Nothing here yet.
                </TableCell>
              </TableRow>
            ) : null}
            {shown.map((r) => {
              const s = STATE[r.state];
              return (
                <TableRow key={r.id} data-state={picked.has(r.id) ? "selected" : undefined}>
                  <TableCell className="pl-4">
                    {r.state === "ready" ? <Checkbox aria-label={`Select ${r.shortId}`} checked={picked.has(r.id)} onCheckedChange={() => toggle(r.id)} /> : null}
                  </TableCell>
                  <TableCell>
                    <a href={r.workUrl} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-1.5 font-medium">
                      @{r.handle}
                      <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                    </a>
                    <p className="text-xs text-muted-foreground">{r.submitted}</p>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a href={r.walletUrl} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-muted-foreground hover:text-foreground">
                          {r.wallet.slice(0, 4)}…{r.wallet.slice(-4)}
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>{r.wallet}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.className}`}>
                      <s.icon className="size-4" />
                      {s.label}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    {r.reason ? (
                      <Badge variant="outline" className="mr-2 font-normal">
                        {r.reason}
                      </Badge>
                    ) : null}
                    <span className="text-sm text-muted-foreground">{r.note ?? "—"}</span>
                  </TableCell>
                  <TableCell className="pr-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`More about ${r.shortId}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a href={r.workUrl} target="_blank" rel="noreferrer">
                            Open the post on X
                          </a>
                        </DropdownMenuItem>
                        {r.decisionId ? (
                          <DropdownMenuItem asChild>
                            <Link href={`/verify/${r.decisionId}`}>Check the decision</Link>
                          </DropdownMenuItem>
                        ) : null}
                        {r.txUrl ? (
                          <DropdownMenuItem asChild>
                            <a href={r.txUrl} target="_blank" rel="noreferrer">
                              Payout transaction
                              <ArrowUpRight className="ml-auto size-3.5" />
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {picked.size > 0 ? (
        <div className="sticky bottom-5 z-30 mx-auto mt-4 flex w-fit items-center gap-4 rounded-full border bg-foreground py-2 pl-5 pr-2 text-background shadow-lg">
          <span className="text-sm">
            {picked.size} selected ·{" "}
            <span className="font-semibold tabular-nums">
              {(Number(reward) * picked.size).toLocaleString("en-US")} USDC
            </span>
          </span>
          <Button size="sm" className="rounded-full bg-brand text-foreground hover:bg-brand/90">
            Approve and pay
          </Button>
        </div>
      ) : null}
    </div>
  );
}
