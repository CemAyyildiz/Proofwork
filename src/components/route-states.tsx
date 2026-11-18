"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

const bar = "rounded-2xl bg-white/[0.06]";

/** Instant placeholder while a dynamic page renders on the server. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1180px] animate-pulse pb-24 pt-4 md:pt-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className={`h-4 w-32 ${bar}`} />
      <div className={`mt-5 h-16 w-3/4 max-w-[640px] ${bar}`} />
      <div className={`mt-6 h-5 w-1/2 max-w-[420px] ${bar}`} />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="h-48 rounded-[28px] bg-white/[0.04]" />
        <div className="h-48 rounded-[28px] bg-white/[0.04]" />
      </div>
    </div>
  );
}

/** The bounty page while it renders: the hero's title, the yellow reward and the slot row, then the paper section. */
export function BountySkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse bg-canvas px-5 pb-14 pt-32 sm:px-6 md:pt-36">
        <div className="mx-auto max-w-6xl">
          <div className={`h-4 w-28 ${bar}`} />
          <div className={`mt-8 h-6 w-72 max-w-full ${bar}`} />
          <div className={`mt-6 h-[clamp(2.6rem,7vw,6.5rem)] w-4/5 ${bar}`} />
          <div className={`mt-3 h-[clamp(2.6rem,7vw,6.5rem)] w-3/5 ${bar}`} />
          <div className="mt-12 h-[clamp(6rem,15vw,12rem)] w-48 rounded-3xl bg-accent/15" />
          <div className="mt-12 grid grid-cols-[repeat(20,minmax(0,1fr))] gap-1.5">
            {Array.from({ length: 20 }, (_, i) => (
              <span key={i} className="h-10 rounded-md border border-white/10 md:h-14" />
            ))}
          </div>
        </div>
      </div>
      <div className="bg-paper px-5 py-16 sm:px-6">
        <div className="mx-auto grid max-w-6xl animate-pulse gap-14 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-4">
            <div className="h-4 w-24 rounded-full bg-black/10" />
            <div className="h-5 w-full rounded-full bg-black/10" />
            <div className="h-5 w-11/12 rounded-full bg-black/10" />
            <div className="h-5 w-2/3 rounded-full bg-black/10" />
          </div>
          <div className="h-[420px] rounded-[28px] bg-black" />
        </div>
      </div>
    </div>
  );
}

/** The bounty directory while it renders: the heading, then a row of cards. */
export function DirectorySkeleton() {
  return (
    <div className="animate-pulse bg-canvas px-5 pb-24 pt-32 sm:px-6 md:pt-40" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mx-auto max-w-6xl">
        <div className={`h-4 w-56 ${bar}`} />
        <div className={`mt-4 h-[clamp(4rem,12vw,10rem)] w-2/3 ${bar}`} />
        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[540px] rounded-[30px] bg-paper/10" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Route error fallback: a way back instead of a blank screen. */
export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-[620px] pb-24 pt-10">
      <div className="rounded-[30px] border border-white/10 bg-[#111] p-8 text-center sm:p-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">Something went wrong</p>
        <p className="mt-4 font-display text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.92]" style={{ fontVariationSettings: '"wdth" 82, "wght" 850' }}>
          This page didn&apos;t load.
        </p>
        <p className="mt-4 text-sm text-white/60">Usually a slow network or a Stellar hiccup. Try again in a moment.</p>
        {error.digest ? <p className="mt-3 font-mono text-[12px] text-white/55">ref {error.digest}</p> : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <Link
            href="/explore"
            className="inline-flex h-12 items-center rounded-full border border-white/20 px-6 text-[14.5px] font-semibold transition-colors hover:bg-white hover:text-black"
          >
            All campaigns
          </Link>
        </div>
      </div>
    </div>
  );
}
