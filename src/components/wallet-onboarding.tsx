"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { onboardingView, type OnboardingNode, type WalletCheck } from "@/components/contributor-state";
import { SubmitForm } from "@/components/submit-form";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import { signTransaction } from "@/wallet/kit";
import {
  buildChangeTrustXdr,
  fundWithFriendbot,
  isSignatureRejection,
  readAccount,
  submitSignedXdr,
} from "@/wallet/onboarding";

type Busy = null | "fund" | "sign" | "submit";

const horizon = { horizonUrl: publicEnv.horizonUrl, usdcIssuer: publicEnv.usdcIssuer };

/**
 * Gets a connected wallet ready to be paid, then shows the submit form.
 * Everything runs in the browser against Horizon testnet and Friendbot; the
 * contributor's wallet signs the trustline and Proofwork never pays or signs
 * for it. The server re-checks the trustline on submit.
 */
export function WalletOnboarding({ campaignSlug, address }: { campaignSlug: string; address: string }) {
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
      else setError(messageOf(e));
    } finally {
      setBusy(null);
      busyRef.current = null;
      await recheck();
    }
  }

  const activate = () =>
    run("fund", async () => {
      try {
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

  const view = onboardingView(check);

  return (
    <>
      {view.step === "ready" ? (
        trustTx ? (
          <p role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="text-pass">USDC trustline added</span>
            <HashChip value={trustTx} href={publicEnv.explorerTxUrl(trustTx)} />
          </p>
        ) : null
      ) : (
        <div className="mt-4 rounded-[14px] border border-line-strong bg-sunken p-4" aria-live="polite">
          {view.step === "checking" ? (
            <p className="text-[13.5px] text-muted">Checking your wallet on Stellar testnet…</p>
          ) : view.step === "unreachable" ? (
            <>
              <p className="text-[13.5px] text-fail">Can&apos;t check your wallet on Stellar testnet right now.</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void recheck()}>
                Retry
              </Button>
            </>
          ) : (
            <>
              <p className="text-[13.5px] leading-normal text-text-2">
                This wallet can&apos;t receive USDC yet. Set it up here in two steps, then submit.
              </p>
              <ol className="mt-3.5 grid gap-3">
                <Node state={view.activate} n={1}>
                  Activate testnet account
                  <Sub>Friendbot sends free testnet XLM so the account exists.</Sub>
                  {view.activate === "current" ? (
                    <Button size="sm" className="mt-2.5" busy={busy === "fund"} busyLabel="Activating on testnet…" disabled={busy !== null} onClick={() => void activate()}>
                      Activate testnet account
                    </Button>
                  ) : null}
                </Node>
                <Node state={view.trustline} n={2}>
                  Add USDC trustline
                  <Sub>Lets this wallet hold USDC. Your wallet signs it; the network fee is paid in testnet XLM.</Sub>
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
                        className="rounded-sm text-[12.5px] text-muted hover:text-text disabled:opacity-35"
                      >
                        Added it in your wallet? Check again
                      </button>
                    </div>
                  ) : null}
                </Node>
              </ol>
            </>
          )}
          {cancelled ? <p className="mt-3 text-[12.5px] text-muted">Signature cancelled in your wallet. Nothing was sent.</p> : null}
          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] text-fail">
              {error}
            </p>
          ) : null}
        </div>
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
          "mt-px grid h-6 w-6 place-items-center rounded-full border-2 font-mono text-[11px] font-semibold",
          state === "done" && "border-pass bg-pass text-accent-ink",
          state === "current" && "border-accent text-accent shadow-[0_0_0_4px_var(--color-accent-soft)]",
          state === "pending" && "border-line-strong text-muted",
        )}
      >
        {state === "done" ? "✓" : n}
      </span>
      <div className={cx("min-w-0 text-[14px] font-semibold", state === "pending" && "text-muted")}>
        {children}
        {state === "done" ? <span className="sr-only"> (done)</span> : null}
      </div>
    </li>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-[12.5px] font-normal leading-normal text-muted">{children}</span>;
}

/** Wallets Kit rejects with plain `{ code, message }` objects, not Errors. */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  const message = e && typeof e === "object" ? (e as { message?: unknown }).message : undefined;
  return typeof message === "string" && message ? message : "wallet error";
}
