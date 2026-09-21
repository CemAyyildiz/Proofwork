import type { Metadata } from "next";
import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";
import { currentUser } from "@/lib/current-user";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-instrument" });

export const metadata: Metadata = {
  title: "Proofwork",
  description: "Human-verified bounties, settled on Stellar.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-text antialiased">
        <header className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="font-semibold">Proofwork</Link>
              {user ? <Link href="/campaigns">Campaigns</Link> : null}
              {user ? <Link href="/review">Review</Link> : null}
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">testnet</span>
            </nav>
            <WalletButton pubkey={user?.pubkey ?? null} />
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
