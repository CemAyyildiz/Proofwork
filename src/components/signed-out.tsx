import Link from "next/link";
import { WalletButton } from "@/components/wallet-button";

/** Workspace page body for a visitor without a session. */
export function SignedOut() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="w-full max-w-[420px] rounded-[20px] border border-line-strong bg-sunken p-[22px] text-center">
        <h1 className="text-lg font-semibold tracking-[-0.02em]">Connect your Stellar wallet to continue.</h1>
        <p className="mt-3 text-sm leading-normal text-text-2">
          Funders see their campaigns here, reviewers their queue. Contributors submit from the campaign link they were sent.
        </p>
        <WalletButton pubkey={null} className="mt-5 justify-center" />
        <p className="mt-4 text-[13px] text-muted">
          Here to earn?{" "}
          <Link href="/explore" className="inline-flex min-h-11 items-center rounded-sm font-medium text-accent hover:underline">
            Browse open campaigns →
          </Link>
        </p>
      </div>
    </div>
  );
}
