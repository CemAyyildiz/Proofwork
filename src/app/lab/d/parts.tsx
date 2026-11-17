import Link from "next/link";
import { cn } from "@/lib/utils";

export const DISPLAY = "[font-family:var(--font-bricolage)] tracking-[-0.03em]";
export const PAPER = "#f4f1e8";

/**
 * Reward slots: a budget of 300 at 10 a post is 30 slots, and each paid post fills one.
 * Above 40 slots a segment stands for several, so the bar stays readable.
 */
export function Slots({ budget, reward, paid, dark = false }: { budget: string; reward: string; paid: number; dark?: boolean }) {
  const slots = Math.max(1, Math.round(Number(budget.replace(/,/g, "")) / Number(reward.replace(/,/g, ""))));
  const segments = Math.min(slots, 40);
  const filled = Math.round((Math.min(paid, slots) / slots) * segments);
  return (
    <div>
      <div className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={cn("h-3 flex-1 rounded-[2px]", i < filled ? (dark ? "bg-[#fdda24]" : "bg-[#0a7d3b]") : dark ? "bg-white/15" : "bg-black/10")} />
        ))}
      </div>
      <p className={cn("mt-2 font-mono text-[11px] uppercase tracking-wider", dark ? "text-white/60" : "text-black/55")}>
        {Math.min(paid, slots)} of {slots} rewards paid · {Math.max(0, slots - paid)} left
      </p>
    </div>
  );
}

/** A torn-ticket edge: a row of paper-coloured holes along the top or bottom of a card. */
export function Perforation({ side }: { side: "top" | "bottom" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-x-0 h-3", side === "top" ? "-top-1.5" : "-bottom-1.5")}
      style={{ background: `radial-gradient(circle, ${PAPER} 5px, transparent 5.5px) 0 0 / 16px 12px repeat-x` }}
    />
  );
}

export function TopBar() {
  return (
    <header className="border-b border-black/10">
      <nav className="mx-auto flex max-w-[1240px] items-center gap-8 px-6 py-4 text-sm">
        <Link href="/lab/d" className={`flex items-center gap-2 text-xl font-bold ${DISPLAY}`}>
          <span className="grid size-7 place-items-center rounded-full bg-[#fdda24] text-xs font-black ring-2 ring-black">✓</span>
          proofwork
        </Link>
        <Link href="/lab/d" className="font-medium">
          Bounties
        </Link>
        <Link href="/verify" className="text-black/60 hover:text-black">
          Verify a payout
        </Link>
        <Link href="/custody" className="hidden text-black/60 hover:text-black sm:block">
          Where the money sits
        </Link>
        <Link href="/campaigns" className="ml-auto rounded-full bg-black px-4 py-2 font-medium text-white hover:bg-black/80">
          Fund a bounty
        </Link>
      </nav>
    </header>
  );
}
