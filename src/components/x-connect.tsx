import type { XNotice } from "@/components/contributor-state";
import { buttonClasses } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

/**
 * The X step of the submit panel: connected, or a link that starts Sign in
 * with X. A plain link on purpose: the flow leaves the site by redirect, which
 * a form post could not do under the CSP's `form-action 'self'`.
 */
export function XConnectStep({ campaignSlug, connected, notice }: { campaignSlug: string; connected: boolean; notice: XNotice | null }) {
  const message = notice ? (
    <p role={notice.tone === "fail" ? "alert" : "status"} className={cx("mt-3 text-[12.5px]", notice.tone === "fail" ? "text-fail" : "text-muted")}>
      {notice.text}
    </p>
  ) : null;

  if (connected) {
    return (
      <>
        <p role="status" className="mt-3 text-[13px] text-pass">
          X account connected
        </p>
        {message}
      </>
    );
  }
  return (
    <div className="mt-4 rounded-[14px] border border-line-strong bg-sunken p-4">
      <p className="text-[14px] font-semibold">Connect your X account</p>
      <p className="mt-1 text-[12.5px] leading-normal text-muted">
        Sign in with X to tie this wallet to the account you post from. Proofwork keeps the account&apos;s ID and nothing else: no
        handle, no access to post. One X account per wallet, and it can&apos;t be changed later.
      </p>
      <a href={`/api/x/connect?slug=${encodeURIComponent(campaignSlug)}`} className={cx(buttonClasses("secondary", "sm"), "mt-2.5")}>
        Connect X
      </a>
      {message}
    </div>
  );
}
