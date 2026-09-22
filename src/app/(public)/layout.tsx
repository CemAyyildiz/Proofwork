import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { TestnetBadge } from "@/components/ui/testnet-badge";
import { WalletButton } from "@/components/wallet-button";
import { WorkspaceNav } from "@/components/workspace-nav";
import { currentUser } from "@/lib/current-user";

/** Public shell: sticky blurred top bar over a centred main. */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-[16px]">
        <div className="flex h-16 items-center justify-between gap-4 px-[18px] md:px-10">
          <div className="flex min-w-0 items-center gap-3 md:gap-6">
            <Link href="/" className="rounded-sm" aria-label="Proofwork home">
              <span className="sm:hidden">
                <Logo wordmark={false} />
              </span>
              <span className="hidden sm:inline">
                <Logo />
              </span>
            </Link>
            {user ? (
              <WorkspaceNav
                funder={user.roles.has("funder")}
                reviewer={user.roles.has("reviewer")}
                variant="top"
                showPublic={false}
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <TestnetBadge />
            <WalletButton pubkey={user?.pubkey ?? null} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-app px-[18px] py-10 md:px-10">{children}</main>
    </>
  );
}
