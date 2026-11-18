"use client";

import { useClock, useSeen } from "@/components/e/motion";
import { cx } from "@/components/ui/cx";
import { BountyCard, type BountyCardData } from "./bounty-card";
import { Odometer } from "./odometer";

/** The explore grid: every card counts down on one shared clock and rises in as it scrolls into view. */
export function BountyGrid({ items, variant }: { items: BountyCardData[]; variant: "open" | "past" }) {
  const now = useClock();
  return (
    <ul className={cx("grid gap-5", variant === "open" ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {items.map((b, i) => (
        <GridItem key={b.slug} i={i}>
          <BountyCard b={b} now={now} className={variant === "open" ? "md:h-[540px]" : "sm:h-[480px]"} />
        </GridItem>
      ))}
    </ul>
  );
}

function GridItem({ i, children }: { i: number; children: React.ReactNode }) {
  const [ref, seen] = useSeen<HTMLLIElement>();
  return (
    <li
      ref={ref}
      className={cx("transition-all duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)]", seen ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0")}
      style={{ transitionDelay: `${(i % 3) * 90}ms` }}
    >
      {children}
    </li>
  );
}

/** A total that rolls up once it is on screen. */
export function RollingTotal({ value, className }: { value: string; className?: string }) {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  return (
    <span ref={ref} className={className}>
      <Odometer value={value} seen={seen} />
    </span>
  );
}
