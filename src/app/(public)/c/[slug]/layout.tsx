import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { campaignFor } from "./campaign";

/**
 * Resolves the campaign above this segment's loading boundary, so an unknown
 * slug still answers with a real 404 while known ones show the skeleton at once.
 */
export default async function CampaignLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  if (!(await campaignFor((await params).slug))) notFound();
  return children;
}
