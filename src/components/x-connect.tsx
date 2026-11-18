import type { XNotice } from "@/components/contributor-state";
import { StepNote, StepRow } from "@/components/site/steps";
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
    <p role={notice.tone === "fail" ? "alert" : "status"} className={cx("mt-2.5 text-[13px]", notice.tone === "fail" ? "text-fail" : "text-muted")}>
      {notice.text}
    </p>
  ) : null;

  if (!available) {
    return (
      <StepRow
        state={connected ? "done" : "pending"}
        title={
          connected ? (
            <span role="status" className="text-white">
              X account connected
            </span>
          ) : (
            "Connect your X account"
          )
        }
      >
        <StepNote>Not available yet. Submissions aren&apos;t possible until Proofwork can check with X who wrote a post.</StepNote>
      </StepRow>
    );
  }
  if (connected) {
    return (
      <StepRow
        state="done"
        title={
          <span role="status" className="text-white">
            X account connected
          </span>
        }
      >
        <StepNote>Submit a post written by this account. Proofwork asks X who wrote it, and a post from another account is refused.</StepNote>
        {message}
      </StepRow>
    );
  }
  return (
    <StepRow state="current" title="Connect your X account">
      <StepNote>You can submit once it is connected, and only a post written by that account is accepted.</StepNote>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={`/api/x/connect?slug=${encodeURIComponent(campaignSlug)}`}
          className="inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-black transition-transform hover:scale-[1.03] active:scale-[0.97]"
        >
          Connect X
        </a>
        <details className="group/xp open:basis-full">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm text-[13px] font-semibold text-white/70 underline decoration-white/25 underline-offset-4 hover:text-white [&::-webkit-details-marker]:hidden">
            What X will ask for
          </summary>
          <p className="mb-1 rounded-2xl bg-white/[0.06] p-4 text-[13px] leading-relaxed text-white/65">
            Sign in with X ties this wallet to the account you post from. X will ask you to let Proofwork read your posts and profile; Proofwork
            reads only the account&apos;s ID and keeps nothing else. One X account per wallet, and it can&apos;t be changed later.
          </p>
        </details>
      </div>
      {message}
    </StepRow>
  );
}
