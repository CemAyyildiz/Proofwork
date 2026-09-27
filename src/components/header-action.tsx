"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { WalletButton } from "@/components/wallet-button";

/**
 * Top-bar action. The landing page sends signed-out visitors into the app,
 * where they connect a wallet; every other public page (campaign, verify)
 * keeps the wallet button so a contributor can connect in place.
 */
export function HeaderAction({ pubkey }: { pubkey: string | null }) {
  const pathname = usePathname();
  if (!pubkey && pathname === "/") {
    return (
      <Link href="/campaigns" className={buttonClasses("primary", "sm")}>
        Launch app <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return <WalletButton pubkey={pubkey} />;
}
