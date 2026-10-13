import type { XNotice } from "@/components/contributor-state";
import { buttonClasses } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

/**
 * The X step of the submit panel, and the gate in front of the form: a post
 * is accepted only when the connected account wrote it. Connected, a link
 * that starts Sign in with X, or a muted step with nothing to press when the
 * deployment has no X credentials: the server then refuses every submission,
 * and the step says so. A plain link on purpose: the flow leaves the site by
 * redirect, which a form post could not do under the CSP's `form-action 'self'`.
 */
export function XConnectStep({
  campaignSlug,
  connected,
  available,
  notice,
}: {
  campaignSlug: string;
  connected: boolean;
  available: boolean;
  notice: XNotice | null;
}) {
  const message = notice ? (
    <p role={notice.tone === "fail" ? "alert" : "status"} className={cx("mt-3 text-[12.5px]", notice.tone === "fail" ? "text-fail" : "text-muted")}>
      {notice.text}
    </p>
  ) : null;

  if (!available) {
    return (
      <div className="mt-4 rounded-[14px] border border-line bg-sunken p-4">
        {connected ? (
          <p role="status" className="text-[13px] text-pass">
            X account connected
          </p>
        ) : (
          <p className="text-[14px] font-semibold text-muted">Connect your X account</p>
        )}
        <p className="mt-1 text-[12.5px] leading-normal text-muted">
          Not available yet. Submissions aren&apos;t possible until Proofwork can check with X who wrote a post.
        </p>
      </div>
    );
  }
  if (connected) {
    return (
      <>
        <p role="status" className="mt-3 text-[13px] text-pass">
          X account connected
        </p>
        <p className="mt-1 text-[12.5px] leading-normal text-muted">
          Submit a post written by this account. Proofwork asks X who wrote it, and a post from another account is refused.
        </p>
        {message}
      </>
    );
  }
  return (
    <div className="mt-4 rounded-[14px] border border-line-strong bg-sunken p-4">
      <p className="text-[14px] font-semibold">Connect your X account</p>
      <p className="mt-1 text-[12.5px] leading-normal text-muted">
        Sign in with X to tie this wallet to the account you post from. You can submit once it is connected, and only a post
        written by that account is accepted. X will ask you to let Proofwork read your posts and profile; Proofwork reads only
        the account&apos;s ID and keeps nothing else. One X account per wallet, and it can&apos;t be changed later.
      </p>
      <a href={`/api/x/connect?slug=${encodeURIComponent(campaignSlug)}`} className={cx(buttonClasses("secondary", "sm"), "mt-2.5")}>
        Connect X
      </a>
      {message}
    </div>
  );
}
