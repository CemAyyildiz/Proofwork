import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { TestnetBadge } from "@/components/ui/testnet-badge";
import { WalletButton } from "@/components/wallet-button";
import { WorkspaceNav } from "@/components/workspace-nav";
import { currentUser } from "@/lib/current-user";

/**
 * Signed-in workspace shell: a 248px sidebar from lg up, a top bar below it.
 * Nav items follow the roles in the session; pages still enforce access.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const funder = user?.roles.has("funder") ?? false;
  const reviewer = user?.roles.has("reviewer") ?? false;
  const pubkey = user?.pubkey ?? null;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-sunken px-3.5 py-5 lg:flex">
        <Link href="/" className="mx-2.5 mb-5 mt-1.5 self-start rounded-sm" aria-label="Proofwork home">
          <Logo />
        </Link>
        <WorkspaceNav funder={funder} reviewer={reviewer} variant="side" />
        <div className="mt-auto grid justify-items-start gap-2.5">
          <TestnetBadge />
          <WalletButton pubkey={pubkey} menuPlacement="up" className="flex-wrap" />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-[16px] lg:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-[18px] md:px-10">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/" className="inline-flex min-h-11 min-w-11 items-center rounded-sm" aria-label="Proofwork home">
                <span className="sm:hidden">
                  <Logo wordmark={false} />
                </span>
                <span className="hidden sm:inline">
                  <Logo />
                </span>
              </Link>
              <WorkspaceNav funder={funder} reviewer={reviewer} variant="top" />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden sm:contents">
                <TestnetBadge />
              </span>
              <WalletButton pubkey={pubkey} />
            </div>
          </div>
        </header>
        <main className="w-full max-w-app px-[18px] py-10 md:px-10 lg:px-9 lg:py-9">{children}</main>
      </div>
    </div>
  );
}
