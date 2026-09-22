import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { TestnetBadge } from "@/components/ui/testnet-badge";
import { WalletButton } from "@/components/wallet-button";
import { WorkspaceNav } from "@/components/workspace-nav";
import { currentUser } from "@/lib/current-user";

/** Public shell: sticky blurred top bar over a full-width main. */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-[16px]">
        <div className="flex h-16 items-center justify-between gap-4 px-[18px] md:px-10">
          <div className="flex items-center gap-6">
            <Link href="/" className="rounded-sm" aria-label="Proofwork home">
              <Logo />
            </Link>
            {user ? (
              <div className="hidden md:block">
                <WorkspaceNav
                  funder={user.roles.has("funder")}
                  reviewer={user.roles.has("reviewer")}
                  variant="top"
                  showPublic={false}
                />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline">
              <TestnetBadge />
            </span>
            <WalletButton pubkey={user?.pubkey ?? null} />
          </div>
        </div>
      </header>
      <main className="w-full px-[18px] py-10 md:px-10">{children}</main>
    </>
  );
}
