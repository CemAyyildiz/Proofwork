import { ImageResponse } from "next/og";
import { OgCard } from "@/components/og/card";
import { formatUsdc } from "@/lib/format";
import { publicCampaign } from "@/services/submission";

export const alt = "Proofwork bounty campaign";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const c = await publicCampaign((await params).slug);
  return new ImageResponse(
    <OgCard
      eyebrow="Bounty campaign"
      title={c?.title ?? "Campaign not found"}
      footer={c ? `${formatUsdc(c.rewardAmount)} per approved post · reviewed by a person · paid from escrow` : "proofwork.online"}
    />,
    size,
  );
}
