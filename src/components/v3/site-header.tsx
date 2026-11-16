import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/shad/badge";
import { Button } from "@/components/shad/button";
import { publicEnv } from "@/config/public-env";

/** Proofwork's mark: the yellow coin with a tick, as on the logo. */
function Mark() {
  return (
    <span className="grid size-7 place-items-center rounded-full bg-brand">
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#17160f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-5">
        <Link href="/v3/explore" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Mark />
          Proofwork
        </Link>
        <nav className="hidden items-center gap-1 text-sm sm:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/v3/explore">Bounties</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/custody">How funds are held</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/campaigns">For teams</Link>
          </Button>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {publicEnv.isMainnet ? null : (
            <Badge variant="outline" className="hidden sm:inline-flex">
              Testnet
            </Badge>
          )}
          <Button asChild size="sm" className="rounded-full pl-4 pr-1.5">
            <Link href={signedIn ? "/campaigns" : "/explore"}>
              {signedIn ? "Workspace" : "Connect wallet"}
              <span className="grid size-6 place-items-center rounded-full bg-brand text-foreground">
                <ArrowUpRight className="size-3.5" />
              </span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
