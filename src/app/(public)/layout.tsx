import Link from "next/link";
import { HeaderAction } from "@/components/header-action";
import { SiteFooter } from "@/components/site/footer";
import { cx } from "@/components/ui/cx";
import { Logo } from "@/components/ui/logo";
import { NetworkBadge } from "@/components/ui/network-badge";
import { WorkspaceNav } from "@/components/workspace-nav";
import { db } from "@/db/client";
import { currentUser } from "@/lib/current-user";
import { adminNav, campaignsNav } from "@/services/access";

/**
 * Public shell: a floating pill nav over full-bleed pages. Each page sets its
 * own top space, so the home hero can run under the nav. A signed-in wallet
 * gets its workspace items on a second row of the pill on phones.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const campaigns = user ? await campaignsNav(user, db) : null;
  const reviewer = user?.roles.has("reviewer") ?? false;
  const admin = user ? await adminNav(user, db) : false;
  const twoRows = campaigns !== null || reviewer || admin;
  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4 sm:px-4">
        <div
          className={cx(
            "pointer-events-auto flex w-full max-w-4xl items-center gap-x-2 border border-white/10 bg-[#0b0b0b]/85 py-1.5 pl-4 pr-1.5 text-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:gap-x-3 sm:rounded-full sm:pl-5",
            twoRows ? "flex-wrap rounded-[26px] sm:flex-nowrap" : "rounded-full",
          )}
        >
          <Link href="/" className="order-1 inline-flex min-h-11 min-w-11 shrink-0 items-center rounded-full" aria-label="Proofwork home">
            <span className="sm:hidden">
              <Logo wordmark={false} />
            </span>
            <span className="hidden sm:inline">
              <Logo />
            </span>
          </Link>
          <div
            className={cx(
              "flex min-w-0 text-white/60 sm:order-2 sm:flex-1 sm:justify-center [&_a]:rounded-full",
              twoRows ? "order-3 -ml-2 w-full border-t border-white/10 pt-1 sm:ml-0 sm:w-auto sm:border-0 sm:pt-0" : "order-2 flex-1",
            )}
          >
            <WorkspaceNav campaigns={campaigns} reviewer={reviewer} admin={admin} variant="top" showPublic={false} />
          </div>
          <div className={cx("flex shrink-0 items-center gap-2 sm:order-3", twoRows ? "order-2 ml-auto" : "order-3")}>
            <span className="hidden md:contents">
              <NetworkBadge />
            </span>
            <HeaderAction pubkey={user?.pubkey ?? null} />
          </div>
        </div>
      </header>
      <main className="min-h-screen">{children}</main>
      <SiteFooter />
    </>
  );
}
