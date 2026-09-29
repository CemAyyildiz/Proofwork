"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";

/** Instant placeholder while a dynamic page renders on the server. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1180px] animate-pulse pb-24 pt-4 md:pt-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-6 w-28 rounded-full bg-white/5" />
      <div className="mt-5 h-14 w-3/4 max-w-[640px] rounded-lg bg-white/5" />
      <div className="mt-6 h-5 w-1/2 max-w-[420px] rounded bg-white/5" />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Card className="h-48" />
        <Card className="h-48" />
      </div>
    </div>
  );
}

/** Route error fallback: a way back instead of a blank screen. */
export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-[560px] pb-24 pt-10">
      <Card className="p-8 text-center">
        <p className="text-lg font-semibold tracking-[-0.02em]">This page didn&apos;t load.</p>
        <p className="mt-2 text-sm text-text-2">Usually a slow network or testnet hiccup. Try again in a moment.</p>
        {error.digest ? <p className="mt-2 font-mono text-[12px] text-muted">ref {error.digest}</p> : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href="/explore" className={buttonClasses("secondary")}>
            All campaigns
          </Link>
        </div>
      </Card>
    </div>
  );
}
