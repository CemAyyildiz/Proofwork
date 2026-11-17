"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { ax } from "@/components/workspace/kit";

/** Workspace error fallback: says what happened and offers a way back instead of a blank screen. */
export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-[640px] pb-24 pt-6 md:pt-12">
      <div className="rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-8 md:p-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">Something went wrong</p>
        <p className="mt-3 font-display text-[clamp(2.4rem,5vw,3.75rem)] leading-[0.9]" style={{ fontVariationSettings: ax(84, 850) }}>
          This page didn&apos;t load.
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-white/60">
          Usually a slow network or a Stellar hiccup. Nothing was signed or sent. Try again in a moment.
        </p>
        {error.digest ? <p className="mt-3 font-mono text-[12px] text-white/40">ref {error.digest}</p> : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href="/explore" className={buttonClasses("secondary")}>
            All campaigns
          </Link>
        </div>
      </div>
    </div>
  );
}
