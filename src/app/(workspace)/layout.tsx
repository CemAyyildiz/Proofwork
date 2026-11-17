import Link from "next/link";
import { NetworkBadge } from "@/components/ui/network-badge";
import { WalletButton } from "@/components/wallet-button";
import { ax } from "@/components/workspace/kit";
import { WorkspaceMenu, WorkspaceNav } from "@/components/workspace-nav";
import { publicEnv } from "@/config/public-env";
import { db } from "@/db/client";
import { currentUser } from "@/lib/current-user";
import { adminNav, campaignsNav } from "@/services/access";

/** The wordmark: lower-case Anybody, wide and heavy, as on the public site. */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-display lowercase leading-none text-text ${className ?? ""}`} style={{ fontVariationSettings: ax(125, 800) }}>
      proofwork<span className="text-accent">.</span>
    </span>
  );
}

/**
 * Signed-in workspace shell: a black rail from lg up with the nav, and the
 * network and wallet at its foot; a top bar with a full-screen menu below lg.
 * Nav items follow the session wallet's roles and campaigns; pages still enforce access.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const campaigns = user ? await campaignsNav(user, db) : null;
  const reviewer = user?.roles.has("reviewer") ?? false;
  const admin = user ? await adminNav(user, db) : false;
  const pubkey = user?.pubkey ?? null;

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-white/[0.07] bg-[#050505] px-3 pb-4 pt-6 lg:flex">
        <Link href="/" className="mx-3 mb-7 self-start rounded-sm text-[23px]" aria-label="Proofwork home">
          <Wordmark />
        </Link>
        <WorkspaceNav campaigns={campaigns} reviewer={reviewer} admin={admin} variant="side" />
        <div className="mt-auto rounded-[22px] border border-white/[0.08] bg-white/[0.025] p-3.5">
          <NetworkBadge />
          <p className="mt-2.5 text-[12px] leading-snug text-white/45">
            {publicEnv.isMainnet ? "Real USDC. Every payout is a Stellar transaction." : "Testnet USDC, not real money."}
          </p>
          <WalletButton pubkey={pubkey} menuPlacement="up" className="mt-3 flex-wrap" />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-canvas/85 backdrop-blur-[16px] lg:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-10">
            <Link href="/" className="inline-flex min-h-11 items-center rounded-sm text-[19px]" aria-label="Proofwork home">
              <Wordmark />
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden sm:contents">
                <NetworkBadge />
              </span>
              <WalletButton pubkey={pubkey} />
              <WorkspaceMenu campaigns={campaigns} reviewer={reviewer} admin={admin} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 md:px-10 lg:px-12 lg:pt-12">{children}</main>
      </div>
    </div>
  );
}
