"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import { describeMissing, USDC_FAUCET_URL, type FundingReadiness, type FundingStep } from "@/domain/funding-readiness";
import { signTransaction } from "@/wallet/kit";
import { buildChangeTrustXdr, fundWithFriendbot, isSignatureRejection, readAccount, submitSignedXdr, walletErrorMessage } from "@/wallet/onboarding";

type Busy = null | "activate" | "trustline";

const horizon = { horizonUrl: publicEnv.horizonUrl, usdcIssuer: publicEnv.usdcIssuer };

/**
 * Says whether the funder's wallet can pay for the escrow transaction it
 * signs next, from the server's read of the wallet when the page was
 * rendered. Every missing item is listed at once. Check again asks the
 * server for a fresh read. The two wallet steps run in the browser, as on the
 * contributor page: Friendbot activates the account and the funder's own
 * wallet signs the trustline. Proofwork sends nothing and signs nothing. The
 * server reads the wallet again before it builds a transaction.
 */
export function FundingReadinessPanel({
  address,
  step,
  readiness,
  fundSent,
}: {
  address: string;
  step: FundingStep;
  readiness: FundingReadiness;
  /** A fund transaction already went to the network; the wallet may read as short because the budget has left it. */
  fundSent: boolean;
}) {
  const router = useRouter();
  const [checking, startCheck] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const recheck = () => startCheck(() => router.refresh());

  async function run(first: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(first);
    setError(null);
    setCancelled(false);
    try {
      await action();
    } catch (e) {
      if (isSignatureRejection(e)) setCancelled(true);
      else setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
      recheck();
    }
  }

  const activate = () =>
    run("activate", async () => {
      try {
        await fundWithFriendbot(address, { friendbotUrl: publicEnv.friendbotUrl });
      } catch {
        throw new Error("Friendbot didn't answer. Try again in a moment.");
      }
    });

  const addTrustline = () =>
    run("trustline", async () => {
      // A fresh read in the browser for the sequence number; nothing to sign when the line is already there.
      const account = await readAccount(address, horizon);
      if (account.kind === "no-account") throw new Error("Activate the account first.");
      if (account.kind !== "no-trustline") return;
      const xdr = await buildChangeTrustXdr(address, account.sequence, {
        usdcIssuer: publicEnv.usdcIssuer,
        networkPassphrase: publicEnv.networkPassphrase,
      });
      await submitSignedXdr(await signTransaction(address, xdr), { horizonUrl: publicEnv.horizonUrl });
    });

  const what = step === "deploy" ? "deploy the escrow and fund the budget" : "fund the budget";
  const noAccount = readiness.status === "not-ready" && readiness.missing.some((m) => m.item === "account");
  const locked = busy !== null || checking;

  return (
    <div className="max-w-[640px] rounded-[14px] border border-line-strong bg-sunken p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold">Wallet readiness</h3>
        {readiness.status === "ready" ? (
          <Pill tone="pass">Ready</Pill>
        ) : readiness.status === "not-ready" ? (
          <Pill tone="fail">Not ready</Pill>
        ) : (
          <Pill tone="wait">Not checked</Pill>
        )}
      </div>

      {readiness.status === "ready" ? (
        <p className="mt-2 text-[13.5px] leading-normal text-text-2">
          This wallet can {what}: {readiness.usdc} USDC to spend and {readiness.xlm} XLM free for network fees.
        </p>
      ) : readiness.status === "unchecked" ? (
        <p className="mt-2 text-[13.5px] leading-normal text-text-2">
          Stellar testnet didn&apos;t answer, so this wallet hasn&apos;t been checked. Deploy and fund stay off until it has. Try
          again in a moment.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[13.5px] leading-normal text-text-2">This wallet can&apos;t {what} yet. What is missing:</p>
          <ul className="mt-3 grid gap-3">
            {readiness.missing.map((m) => (
              <li key={m.item} className="text-[13.5px] leading-normal text-text">
                {describeMissing(m)}
                {m.item === "account" ? (
                  <div className="mt-2">
                    <Button size="sm" busy={busy === "activate"} busyLabel="Activating on testnet…" disabled={locked} onClick={() => void activate()}>
                      Activate testnet account
                    </Button>
                  </div>
                ) : m.item === "trustline" ? (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      busy={busy === "trustline"}
                      busyLabel="Awaiting your signature…"
                      disabled={locked || noAccount}
                      onClick={() => void addTrustline()}
                    >
                      Add USDC trustline
                    </Button>
                  </div>
                ) : m.item === "usdc" ? (
                  <div className="mt-1">
                    <a className="font-medium text-accent hover:underline" href={USDC_FAUCET_URL} target="_blank" rel="noreferrer">
                      Open Circle&apos;s faucet ↗
                    </a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {fundSent && readiness.status !== "ready" ? (
        <p className="mt-3 text-[12.5px] leading-normal text-muted">
          A fund transaction was already sent for this campaign. If it reached the escrow, the budget has left this wallet: press
          Fund budget and the escrow is read before anything new is built.
        </p>
      ) : null}
      {cancelled ? <p className="mt-3 text-[12.5px] text-muted">Signature cancelled in your wallet. Nothing was sent.</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-fail">
          {error}
        </p>
      ) : null}

      <Button variant="secondary" size="sm" className="mt-3" busy={checking} busyLabel="Checking…" disabled={busy !== null} onClick={recheck}>
        {readiness.status === "unchecked" ? "Retry" : "Check again"}
      </Button>
    </div>
  );
}
