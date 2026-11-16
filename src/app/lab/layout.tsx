import type { Metadata } from "next";
import { Archivo_Black, Fraunces } from "next/font/google";

const archivoBlack = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-archivo-black" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });

export const metadata: Metadata = { title: "Design directions", robots: { index: false } };

/** Three design directions for the same bounty list, side by side under /lab. Drafts only. */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <div className={`lab ${archivoBlack.variable} ${fraunces.variable}`}>{children}</div>;
}
