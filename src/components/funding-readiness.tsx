"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import { describeMissing, USDC_FAUCET_URL, type FundingReadiness, type FundingStep, type MissingItem } from "@/domain/funding-readiness";
import { signTransaction } from "@/wallet/kit";
import { buildChangeTrustXdr, fundWithFriendbot, isSignatureRejection, readAccount, submitSignedXdr, walletErrorMessage } from "@/wallet/onboarding";

type Busy = null | "activate" | "trustline";

const horizon = { horizonUrl: publicEnv.horizonUrl, usdcIssuer: publicEnv.usdcIssuer };

/** A funder limit the campaign does not fit under, drawn by the page as one more item on the checklist. */
export interface LimitItem {
  key: string;
  /** The collapsed line: the limit and its figures. */
  title: string;
  /** What opens under it: the service's words and the meter. */
  body: ReactNode;
}

/** The collapsed line for one missing wallet item; the full sentence opens under it. */
function missingTitle(m: MissingItem): string {
  switch (m.item) {
    case "account":
      return publicEnv.isMainnet ? "Create the account" : "Activate the account";
    case "trustline":
      return "Add the USDC trustline";
    case "usdc":
      return `USDC: ${m.have} of ${m.need} needed`;
    case "xlm":
      return `XLM for fees: ${m.have} of ${m.need} needed`;
  }
}

/**
 * The one checklist between a draft and its next escrow step: the funder
 * limits it breaks (from the page) and what the wallet lacks, numbered, with a
 * single red count. The first unmet item is open, and the first wallet item
 * with it; the rest open on a click.
 * Says whether the funder's wallet can pay for the escrow transaction it
 * signs next, from the server's read of the wallet when the page was
 * rendered. Every missing item is listed at once. Check again asks the
 * server for a fresh read. The two wallet steps run in the browser, as on the
 * contributor page: on testnet Friendbot activates the account, and the funder's own
 * wallet signs the trustline. Proofwork sends nothing and signs nothing. The
 * server reads the wallet again before it builds a transaction.
 */
export function FundingReadinessPanel({
  address,
  step,
  readiness,
  fundSent,
  limits = [],
}: {
  address: string;
  step: FundingStep;
  readiness: FundingReadiness;
  /** A fund transaction already went to the network; the wallet may read as short because the budget has left it. */
  fundSent: boolean;
  /** Limits the campaign breaks; each is one more unmet item, listed first. */
  limits?: LimitItem[];
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
        // The button is only rendered where Friendbot exists (testnet).
        if (publicEnv.friendbotUrl === null) return;
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
  const missing = readiness.status === "not-ready" ? readiness.missing : [];
  const noAccount = missing.some((m) => m.item === "account");
  const locked = busy !== null || checking;
  const toFix = limits.length + missing.length;

  const action = (m: MissingItem): ReactNode =>
    publicEnv.isMainnet && m.item !== "trustline" ? null : m.item === "account" ? (
      <Button size="sm" busy={busy === "activate"} busyLabel="Activating on testnet…" disabled={locked} onClick={() => void activate()}>
        Activate testnet account
      </Button>
    ) : m.item === "trustline" ? (
      <Button
        size="sm"
        // Activation comes first: until then this is not the next thing to press, so it is not yellow.
        variant={noAccount ? "secondary" : "primary"}
        busy={busy === "trustline"}
        busyLabel="Awaiting your signature…"
        disabled={locked || noAccount}
        onClick={() => void addTrustline()}
      >
        Add USDC trustline
      </Button>
    ) : m.item === "usdc" ? (
      <a className="font-semibold text-text underline decoration-white/35 underline-offset-4 hover:decoration-white" href={USDC_FAUCET_URL} target="_blank" rel="noreferrer">
        Open Circle&apos;s faucet ↗
      </a>
    ) : null;

  const items: Array<{ key: string; title: string; body: ReactNode }> = [
    ...limits,
    ...missing.map((m) => {
      const act = action(m);
      return {
        key: m.item,
        title: missingTitle(m),
        body: (
          <>
            <p>{describeMissing(m, publicEnv.network)}</p>
            {act ? <div className="mt-3">{act}</div> : null}
          </>
        ),
      };
    }),
  ];

  return (
    <div className="max-w-[680px] rounded-[22px] bg-white/[0.03] p-4 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">{`Before you ${step}`}</h3>
        {toFix > 0 ? (
          <span className="inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full border border-fail-line bg-fail-soft px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-fail">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {readiness.status === "not-ready" ? `Not ready · ${toFix} to fix` : `${toFix} to fix`}
          </span>
        ) : readiness.status === "ready" ? (
          <Pill tone="pass">Ready</Pill>
        ) : null}
      </div>

      {readiness.status === "not-ready" ? (
        <p className="mt-3 text-[14px] leading-relaxed text-white/70">This wallet can&apos;t {what} yet. Work down the list; Check again reads it afresh.</p>
      ) : null}

      <ol className="mt-4 grid gap-2">
        {items.map((it, i) => (
          <li key={it.key}>
            {/* The first item opens, and so does the first wallet item: a limit can't be fixed here, the wallet's buttons can. */}
            <details open={i === 0 || i === limits.length} className="group rounded-[16px] border border-white/[0.07] bg-[#0b0b0b] open:border-white/15">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-[13.5px] font-semibold text-text [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full border border-white/25 font-mono text-[10px] font-medium text-white/70">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{it.title}</span>
                <span aria-hidden="true" className="text-base font-normal text-white/50 transition-transform duration-200 group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="px-4 pb-4 text-[13.5px] sm:pl-12 leading-relaxed text-white/75">{it.body}</div>
            </details>
          </li>
        ))}
        {readiness.status === "ready" ? (
          <li className="flex items-start gap-3 rounded-[16px] border border-white/[0.07] px-4 py-3 text-[13.5px] leading-relaxed text-white/75">
            <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-pass-soft text-[11px] text-pass">
              ✓
            </span>
            <span>
              <span className="sr-only">Done: </span>This wallet can {what}: {readiness.usdc} USDC to spend and {readiness.xlm} XLM free for network fees.
            </span>
          </li>
        ) : readiness.status === "unchecked" ? (
          <li className="flex flex-wrap items-start gap-3 rounded-[16px] border border-white/[0.07] px-4 py-3 text-[13.5px] leading-relaxed text-white/75">
            <Pill tone="wait">Not checked</Pill>
            <span className="min-w-0 flex-1 basis-[240px]">
              {publicEnv.networkName} didn&apos;t answer, so this wallet hasn&apos;t been checked.{" "}
              {fundSent ? "Try again in a moment." : "Deploy and fund stay off until it has. Try again in a moment."}
            </span>
          </li>
        ) : null}
      </ol>

      {fundSent && readiness.status !== "ready" ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-white/60">
          A fund transaction was already sent for this campaign, so the Fund budget button stays on. Pressing it reads the escrow
          first: if the budget is there, the campaign is marked funded and nothing new is built or signed. That is also why this
          wallet may read as short of USDC.
        </p>
      ) : null}
      {cancelled ? <p className="mt-3 text-[12.5px] text-white/60">Signature cancelled in your wallet. Nothing was sent.</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-fail">
          {error}
        </p>
      ) : null}

      <Button variant="secondary" size="sm" className="mt-4" busy={checking} busyLabel="Checking…" disabled={busy !== null} onClick={recheck}>
        {readiness.status === "unchecked" ? "Retry" : "Check again"}
      </Button>
    </div>
  );
}
