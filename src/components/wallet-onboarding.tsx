"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { onboardingView, type OnboardingNode, type WalletCheck, type XGate } from "@/components/contributor-state";
import { SubmitForm } from "@/components/submit-form";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { StepNote, StepRow } from "@/components/site/steps";
import { publicEnv } from "@/config/public-env";
import { signTransaction } from "@/wallet/kit";
import {
  buildChangeTrustXdr,
  fundWithFriendbot,
  isSignatureRejection,
  readAccount,
  submitSignedXdr,
  walletErrorMessage,
} from "@/wallet/onboarding";

type Busy = null | "fund" | "sign" | "submit";

const horizon = { horizonUrl: publicEnv.horizonUrl, usdcIssuer: publicEnv.usdcIssuer };

/**
 * Gets a connected wallet ready to be paid, then shows the submit form.
 * Everything runs in the browser against Horizon (and Friendbot on testnet;
 * on mainnet the contributor sends the first XLM to the wallet); the
 * contributor's wallet signs the trustline and Proofwork never pays or signs
 * for it. The form also stays locked until the X gate is open (see
 * `onboardingView`). The server re-checks the trustline and the X account on
 * submit.
 */
export function WalletOnboarding({ campaignSlug, address, x }: { campaignSlug: string; address: string; x: XGate }) {
  const [check, setCheck] = useState<WalletCheck>({ status: "checking" });
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [trustTx, setTrustTx] = useState<string | null>(null);
  const seq = useRef(0);
  const busyRef = useRef<Busy>(null);

  /** Re-reads the account. Only the latest read wins, so a slow reply never overwrites a newer one. */
  const recheck = useCallback(async () => {
    const mine = ++seq.current;
    let next: WalletCheck;
    try {
      next = { status: "read", account: await readAccount(address, horizon) };
    } catch {
      next = { status: "unreachable" };
    }
    if (mine === seq.current) setCheck(next);
  }, [address]);

  useEffect(() => {
    void recheck();
    // A trustline added in Freighter directly shows up when the contributor comes back to the tab.
    function onFocus() {
      if (busyRef.current === null && document.visibilityState === "visible") void recheck();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [recheck]);

  async function run(first: Busy, action: () => Promise<void>) {
    setBusy(first);
    busyRef.current = first;
    setError(null);
    setCancelled(false);
    try {
      await action();
    } catch (e) {
      if (isSignatureRejection(e)) setCancelled(true);
      else setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
      busyRef.current = null;
      await recheck();
    }
  }

  const activate = () =>
    run("fund", async () => {
      try {
        // The button is only rendered where Friendbot exists (testnet).
        if (publicEnv.friendbotUrl === null) return;
        await fundWithFriendbot(address, { friendbotUrl: publicEnv.friendbotUrl });
      } catch {
        throw new Error("Friendbot didn't answer. Try again in a moment.");
      }
    });

  const addTrustline = () =>
    run("sign", async () => {
      if (check.status !== "read" || check.account.kind !== "no-trustline") return;
      const xdr = await buildChangeTrustXdr(address, check.account.sequence, {
        usdcIssuer: publicEnv.usdcIssuer,
        networkPassphrase: publicEnv.networkPassphrase,
      });
      const signed = await signTransaction(address, xdr);
      setBusy("submit");
      busyRef.current = "submit";
      setTrustTx(await submitSignedXdr(signed, { horizonUrl: publicEnv.horizonUrl }));
    });

  const view = onboardingView(check, x);

  const notes = (
    <>
      {cancelled ? <p className="mt-3 text-[12.5px] text-white/55">Signature cancelled in your wallet. Nothing was sent.</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-fail">
          {error}
        </p>
      ) : null}
    </>
  );

  const setup = (
    <ol className="mt-4 grid gap-3.5 rounded-2xl bg-white/[0.05] p-4">
      <Node state={view.activate} n={1}>
        {publicEnv.isMainnet ? (
          <>
            Send XLM to this wallet
            <Sub>
              A Stellar account opens once it holds XLM. Send at least 2 XLM to this wallet&apos;s address from an exchange or another
              wallet: 1 XLM opens the account, 0.5 XLM is held by the USDC trustline, the rest pays network fees.
            </Sub>
            {view.activate === "current" ? (
              <Button variant="secondary" size="sm" className="mt-2.5" disabled={busy !== null} onClick={() => void recheck()}>
                Sent it? Check again
              </Button>
            ) : null}
          </>
        ) : (
          <>
            Activate testnet account
            <Sub>Friendbot sends free testnet XLM so the account exists.</Sub>
            {view.activate === "current" ? (
              <Button size="sm" className="mt-2.5" busy={busy === "fund"} busyLabel="Activating on testnet…" disabled={busy !== null} onClick={() => void activate()}>
                Activate testnet account
              </Button>
            ) : null}
          </>
        )}
      </Node>
      <Node state={view.trustline} n={2}>
        Add USDC trustline
        <Sub>Lets this wallet hold USDC. Your wallet signs it; the network fee is paid in XLM.</Sub>
        {view.trustline === "current" ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              busy={busy === "sign" || busy === "submit"}
              busyLabel={busy === "submit" ? "Submitting to Stellar…" : "Awaiting your signature…"}
              disabled={busy !== null}
              onClick={() => void addTrustline()}
            >
              Add USDC trustline
            </Button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void recheck()}
              className="rounded-sm text-[12.5px] text-white/55 underline decoration-white/25 underline-offset-4 hover:text-white disabled:opacity-35"
            >
              Added it in your wallet? Check again
            </button>
          </div>
        ) : null}
      </Node>
    </ol>
  );

  // X is the open step in front of this one: connect it first.
  const xFirst = x.available && !x.connected;

  // One status line that lives as long as the step does: every branch below is the same StepRow and puts this first,
  // so the region is never re-created and each new result is read out.
  const said =
    view.step === "ready"
      ? trustTx
        ? "USDC trustline added. This wallet can receive USDC."
        : "This wallet can receive USDC."
      : view.step === "checking"
        ? `Checking your wallet on ${publicEnv.networkName}.`
        : view.step === "unreachable"
          ? `Can't check your wallet on ${publicEnv.networkName} right now.`
          : xFirst
            ? "Wallet set-up is next, after X."
            : view.activate === "current"
              ? "This wallet can't receive USDC yet. Step 1: activate the account."
              : "Account active. Next, add the USDC trustline.";
  const live = (
    <p role="status" aria-live="polite" className="sr-only">
      {said}
    </p>
  );

  return (
    <>
      {view.step === "ready" ? (
        <StepRow state="done" title="Wallet can receive USDC">
          {live}
          {trustTx ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/55">
              <span className="text-pass">USDC trustline added</span>
              <HashChip value={trustTx} href={publicEnv.explorerTxUrl(trustTx)} />
            </p>
          ) : null}
          {notes}
        </StepRow>
      ) : view.step === "checking" ? (
        <StepRow state="pending" title={`Checking your wallet on ${publicEnv.networkName}…`}>
          {/* Children as a list in every branch, so React keeps the one status line in place. */}
          {live}
          {null}
        </StepRow>
      ) : view.step === "unreachable" ? (
        <StepRow state="fail" title={<span className="text-fail">Can&apos;t check your wallet on {publicEnv.networkName} right now.</span>}>
          {live}
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void recheck()}>
            Retry
          </Button>
          {notes}
        </StepRow>
      ) : xFirst ? (
        // One open step at a time: while X is the step in front, this one waits folded, and can still be done now.
        <StepRow state="pending" title="Get this wallet ready for USDC">
          {live}
          <details className="group/w">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-1.5 text-[13px] text-white/60 [&::-webkit-details-marker]:hidden">
              Next, after X.
              <span className="rounded-sm font-semibold text-white/80 underline decoration-white/25 underline-offset-4 group-open/w:hidden hover:text-white">
                Set it up now
              </span>
            </summary>
            {setup}
            {notes}
          </details>
        </StepRow>
      ) : (
        <StepRow state="current" title="Get this wallet ready for USDC">
          {live}
          <StepNote>This wallet can&apos;t receive USDC yet. Set it up here in two steps, then submit.</StepNote>
          {setup}
          {notes}
        </StepRow>
      )}
      <SubmitForm campaignSlug={campaignSlug} payTo={address} locked={!view.canSubmit} />
    </>
  );
}

function Node({ state, n, children }: { state: OnboardingNode; n: number; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3">
      <span
        aria-hidden="true"
        className={cx(
          "mt-px grid h-6 w-6 place-items-center rounded-full font-mono text-[11px] font-semibold",
          state === "done" && "bg-white text-black",
          state === "current" && "bg-accent text-black",
          state === "pending" && "border border-white/15 text-white/40",
        )}
      >
        {state === "done" ? "✓" : n}
      </span>
      <div className={cx("min-w-0 text-[14px] font-semibold", state === "pending" && "text-white/55")}>
        {children}
        {state === "done" ? <span className="sr-only"> (done)</span> : null}
      </div>
    </li>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-[12.5px] font-normal leading-relaxed text-white/55">{children}</span>;
}
