import type { Metadata } from "next";
import { Anybody, Archivo_Black, Bricolage_Grotesque, Fraunces } from "next/font/google";

const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-archivo-black" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
// Variable width and weight: direction E animates both axes on scroll and pointer.
const anybody = Anybody({ subsets: ["latin"], axes: ["wdth"], variable: "--font-anybody" });

export const metadata: Metadata = { title: "Design directions", robots: { index: false } };

/** Design directions for the same bounty list, side by side under /lab. Drafts only. */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <div className={`lab ${archivoBlack.variable} ${fraunces.variable} ${bricolage.variable} ${anybody.variable}`}>{children}</div>;
}
