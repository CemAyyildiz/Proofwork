import { ImageResponse } from "next/og";
import { OgCard } from "@/components/og/card";

export const alt = "Proofwork: bounties you can prove";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <OgCard eyebrow="Human-verified bounties" title="Bounties you can prove." footer="Escrow-funded · reviewed by a person · settled on Stellar" />,
    size,
  );
}
