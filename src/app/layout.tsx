import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-instrument" });

export const metadata: Metadata = {
  title: "Proofwork",
  description: "Human-verified bounties, settled on Stellar.",
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
