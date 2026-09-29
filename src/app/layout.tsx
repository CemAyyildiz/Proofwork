import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-instrument" });

const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Proofwork: bounties you can prove", template: "%s · Proofwork" },
  description: "Human-verified bounties, settled on Stellar.",
  openGraph: {
    siteName: "Proofwork",
    type: "website",
    title: "Proofwork: bounties you can prove",
    description: "Escrow-funded, reviewed by a person, settled on-chain.",
  },
  twitter: { card: "summary_large_image", site: "@proofworkapp" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-text antialiased">
        {children}
        {/* Vercel Web Analytics, served same-origin by Vercel; cookieless page views only. Absent outside Vercel. */}
        {process.env.VERCEL ? <Script src="/_vercel/insights/script.js" strategy="afterInteractive" /> : null}
      </body>
    </html>
  );
}
