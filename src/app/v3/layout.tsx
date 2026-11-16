import { TooltipProvider } from "@/components/shad/tooltip";
import { SiteHeader } from "@/components/v3/site-header";
import { currentUser } from "@/lib/current-user";

/** Shell of the v3 draft pages. The `v3` class switches the page to the light token set (globals.css). */
export default async function V3Layout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="v3 min-h-screen bg-background text-foreground">
      <TooltipProvider>
        <SiteHeader signedIn={user !== null} />
        <main className="mx-auto max-w-[1200px] px-5 pb-24">{children}</main>
      </TooltipProvider>
    </div>
  );
}
