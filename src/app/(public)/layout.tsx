import Link from "next/link";
import { HeaderAction } from "@/components/header-action";
import { SiteFooter } from "@/components/site/footer";
import { cx } from "@/components/ui/cx";
import { Logo } from "@/components/ui/logo";
import { NetworkBadge } from "@/components/ui/network-badge";
import { WorkspaceMenu, WorkspaceNav } from "@/components/workspace-nav";
import { db } from "@/db/client";
import { currentUser } from "@/lib/current-user";
import { adminNav, campaignsNav } from "@/services/access";

/**
 * Public shell: a solid black pill nav floating over full-bleed pages. Each
 * page sets its own top space, so the home hero can run under the nav. A
 * signed-in wallet gets its workspace items inline from sm up, and behind a
 * Menu button on phones, so the pill stays one row.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const campaigns = user ? await campaignsNav(user, db) : null;
  const reviewer = user?.roles.has("reviewer") ?? false;
  const admin = user ? await adminNav(user, db) : false;
  const workspace = campaigns !== null || reviewer || admin;
  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4 sm:px-4">
        <div className="pointer-events-auto relative flex w-full max-w-4xl items-center gap-x-2 rounded-full border border-white/10 bg-[#0b0b0b] py-1.5 pl-4 pr-1.5 text-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] sm:gap-x-3 sm:pl-5">
          <Link href="/" className="inline-flex min-h-11 min-w-11 shrink-0 items-center rounded-full" aria-label="Proofwork home">
            <span className="sm:hidden">
              <Logo wordmark={false} />
            </span>
            <span className="hidden sm:inline">
              <Logo />
            </span>
          </Link>
          <div className={cx("min-w-0 flex-1 justify-center text-white/60 [&_a]:rounded-full", workspace ? "hidden sm:flex" : "flex")}>
            <WorkspaceNav campaigns={campaigns} reviewer={reviewer} admin={admin} variant="top" showPublic={false} />
          </div>
          {workspace ? (
            <div className="flex-1 sm:hidden">
              <WorkspaceMenu campaigns={campaigns} reviewer={reviewer} admin={admin} showPublic={false} />
            </div>
          ) : null}
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:contents">
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
