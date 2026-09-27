"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";

/**
 * Top-bar action. The landing page sends signed-out visitors to the public
 * campaign list; every other public page (explore, campaign, verify) keeps
 * the wallet button so a contributor can connect when submitting.
 */
export function HeaderAction({ pubkey }: { pubkey: string | null }) {
  const pathname = usePathname();
  if (!pubkey && pathname === "/") {
    return (
      <Link href="/explore" className={buttonClasses("primary", "sm")}>
        Launch app <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return <WalletButton pubkey={pubkey} />;
}
