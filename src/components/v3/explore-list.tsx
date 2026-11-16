"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock, Search, Users } from "lucide-react";
import { Badge } from "@/components/shad/badge";
import { Button } from "@/components/shad/button";
import { Input } from "@/components/shad/input";
import { Progress } from "@/components/shad/progress";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/shad/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/shad/tabs";
import { TeamAvatar, Usdc } from "./bits";

export interface ExploreItem {
  id: string;
  slug: string;
  title: string;
  brief: string;
  team: string | null;
  /** Plain numbers as text: "10", "300". */
  reward: string;
  budget: string;
  paidAmount: string;
  /** Share of the budget already paid out, 0 to 100. */
  paidPct: number;
  open: boolean;
  /** "closes in 6d 4h" or "ended 13 Nov". */
  when: string;
  submissions: number;
  paid: number;
}

type Filter = "open" | "ended" | "all";

export function ExploreList({ items }: { items: ExploreItem[] }) {
  const [filter, setFilter] = useState<Filter>(items.some((i) => i.open) ? "open" : "all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ExploreItem | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (filter === "all" || (filter === "open") === i.open) && (q === "" || `${i.title} ${i.team ?? ""}`.toLowerCase().includes(q)));
  }, [items, filter, query]);

  const count = (f: Filter) => (f === "all" ? items.length : items.filter((i) => (f === "open") === i.open).length);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {(["open", "ended", "all"] as const).map((f) => (
              <TabsTrigger key={f} value={f} className="gap-1.5 capitalize">
                {f}
                <span className="text-xs tabular-nums text-muted-foreground">{count(f)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bounties or teams" aria-label="Search bounties" className="bg-card pl-8" />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          {items.length === 0 ? "No campaign is live yet. The first one appears here as soon as its budget is in escrow." : "Nothing matches. Try another word or tab."}
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-xl border bg-card">
          {shown.map((i) => (
            <li key={i.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => setPreview(i)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-4 text-left transition-colors hover:bg-muted/60 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5"
              >
                <TeamAvatar name={i.team ?? i.title} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{i.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                    {i.team ? <span className="font-medium text-foreground/80">{i.team}</span> : null}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {i.when}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" />
                      {i.submissions}
                    </span>
                    {i.paid > 0 ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3.5" />
                        {i.paid} paid
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="col-start-2 flex items-center gap-3 sm:col-start-3 sm:flex-col sm:items-end sm:gap-1">
                  <Usdc amount={i.reward} className="text-base" />
                  <span className="text-xs text-muted-foreground">per approved post</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={preview !== null} onOpenChange={(open) => (open ? null : setPreview(null))}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          {preview ? (
            <>
              <SheetHeader className="gap-3 border-b p-6">
                <div className="flex items-center gap-3">
                  <TeamAvatar name={preview.team ?? preview.title} />
                  <div className="min-w-0">
                    {preview.team ? <p className="text-sm text-muted-foreground">{preview.team}</p> : null}
                    <Badge variant={preview.open ? "default" : "secondary"} className={preview.open ? "bg-success-soft text-success" : ""}>
                      {preview.open ? "Open" : "Ended"}
                    </Badge>
                  </div>
                </div>
                <SheetTitle className="text-xl leading-snug">{preview.title}</SheetTitle>
                <SheetDescription className="sr-only">Summary of this bounty</SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-6 overflow-y-auto p-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Reward</p>
                    <Usdc amount={preview.reward} className="mt-1 text-lg" />
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Deadline</p>
                    <p className="mt-1 text-lg font-semibold">{preview.when.replace(/^closes /, "")}</p>
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Paid from escrow</span>
                    <span className="font-medium tabular-nums">
                      {preview.paidAmount} of {preview.budget} USDC
                    </span>
                  </div>
                  <Progress value={preview.paidPct} className="mt-2 h-2" />
                </div>
                <div>
                  <p className="text-sm font-semibold">The task</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{preview.brief}</p>
                </div>
              </div>
              <SheetFooter className="border-t p-6">
                <Button asChild size="lg" className="w-full">
                  <Link href={`/v3/c/${preview.slug}`}>
                    {preview.open ? "View and submit" : "View campaign"}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
