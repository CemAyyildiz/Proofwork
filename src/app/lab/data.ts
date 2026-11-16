import "server-only";
import { formatRelative } from "@/lib/format";
import { publicDirectory, publicTotals, recentPayouts } from "@/services/public-directory";

export interface LabItem {
  id: string;
  slug: string;
  title: string;
  brief: string;
  team: string;
  reward: string;
  budget: string;
  paidAmount: string;
  paidPct: number;
  open: boolean;
  deadlineAt: Date;
  /** "in 6d 4h" or "9d ago", measured to the deadline. */
  distance: string;
  submissions: number;
  paid: number;
}

/** "10" from "10.0000000". */
export function plain(amount: string): string {
  const [whole, frac = ""] = amount.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
}

export async function labData() {
  const now = new Date();
  const [list, totals, paid] = await Promise.all([publicDirectory(undefined, now), publicTotals(), recentPayouts(8)]);
  const items: LabItem[] = list.map((c) => {
    const paidAmount = Number(c.rewardAmount) * c.paid;
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      brief: c.brief,
      team: c.team ?? "Independent",
      reward: plain(c.rewardAmount),
      budget: plain(c.budget),
      paidAmount: plain(String(paidAmount)),
      paidPct: Math.min(100, Math.round((paidAmount / Number(c.budget)) * 100)),
      open: c.open,
      deadlineAt: c.deadlineAt,
      distance: formatRelative(c.deadlineAt, now),
      submissions: c.submissions,
      paid: c.paid,
    };
  });
  return { now, items, totals, paid };
}

/** A stable number from a string, so a campaign always gets the same colour or artwork. */
export function seed(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
