import Link from "next/link";
import { publicEnv } from "@/config/public-env";

/** The public pages' foot: where Proofwork runs, where to read about custody, and who it is not. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-canvas px-6 pb-10 pt-8 text-white/45 [body:has(.pw-submit-bar)_&]:pb-32 lg:[body:has(.pw-submit-bar)_&]:pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="font-mono text-[11px] uppercase leading-relaxed tracking-[0.18em]">
          <p>
            © 2026 Proofwork · {publicEnv.networkName}
          </p>
          <p className="mt-1">Stellar Instawards grantee · human-reviewed · escrow-paid</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/explore" className="rounded-sm transition-colors hover:text-white">
            Bounties
          </Link>
          <Link href="/custody" className="rounded-sm transition-colors hover:text-white">
            Custody and fees
          </Link>
          <a href="https://x.com/proofworkapp" target="_blank" rel="noreferrer" className="rounded-sm transition-colors hover:text-white">
            @proofworkapp ↗
          </a>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-6xl text-[12.5px] leading-relaxed text-white/35">
        Independent software, not affiliated with, sponsored or endorsed by the Stellar Development Foundation.{publicEnv.isMainnet ? "" : " Testnet only."}
      </p>
    </footer>
  );
}
