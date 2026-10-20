"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import { formatUsdc } from "@/lib/format";
import { signTransaction } from "@/wallet/kit";
import { isSignatureRejection, walletErrorMessage } from "@/wallet/onboarding";

/** What the server prepared: the unsigned return, with the amount and receiver it read from chain. */
export interface PreparedReturn {
  opId: string;
  unsignedXdr: string;
  amount: string;
  funder: string;
}

/** A refused request, with its status so the outcome can say whether anything was sent. */
export class RemainderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RemainderRequestError";
  }
}

async function remainderCall<T>(campaignId: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/remainder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new RemainderRequestError(json.message ?? `request failed (${res.status})`, res.status);
  return json;
}

export type ReturnOutcome =
  | { kind: "returned"; txHash: string }
  /** The wallet declined: nothing was sent. */
  | { kind: "cancelled" }
  /** The wallet failed to sign, or the server refused before sending. */
  | { kind: "not_sent"; message: string }
  /** The signed transaction was handed over and the answer was an error: it may be on chain. */
  | { kind: "unknown"; message: string };

/** Statuses the route answers before it sends anything: bad input, no session, not the resolver, unknown op, rate limit. */
const BEFORE_SEND = new Set([400, 401, 403, 404, 429]);

const message = (e: unknown) => (e instanceof Error ? e.message : walletErrorMessage(e));

/** A message as the start of a sentence that goes on: one trailing period dropped, so ". Nothing was sent." never reads "..". */
const clause = (text: string) => text.replace(/\.$/, "");

/** The server says the return already went out: the page behind it is out of date. */
export function alreadyReturned(serverMessage: string): boolean {
  return /already (confirmed|returned)/i.test(serverMessage);
}

/** The line for a refused prepare. Not "nothing was sent": an earlier submit of this return may be on its way. */
export function describePrepareFailure(serverMessage: string): string {
  return `Return not prepared: ${clause(serverMessage)}.`;
}

/**
 * Sign a prepared return in the wallet and hand it to the server. A cancel
 * is read only from the signing step; a server answer is never taken for
 * one, whatever its text says.
 */
export async function signAndSubmit(
  op: Pick<PreparedReturn, "opId" | "unsignedXdr">,
  deps: { sign: (unsignedXdr: string) => Promise<string>; submit: (body: { opId: string; signedXdr: string }) => Promise<{ txHash: string }> },
): Promise<ReturnOutcome> {
  let signedXdr: string;
  try {
    signedXdr = await deps.sign(op.unsignedXdr);
  } catch (e) {
    return isSignatureRejection(e) ? { kind: "cancelled" } : { kind: "not_sent", message: message(e) };
  }
  try {
    return { kind: "returned", txHash: (await deps.submit({ opId: op.opId, signedXdr })).txHash };
  } catch (e) {
    if (e instanceof RemainderRequestError && BEFORE_SEND.has(e.status)) return { kind: "not_sent", message: e.message };
    return { kind: "unknown", message: message(e) };
  }
}

/** The line shown for an outcome that is not a return. */
export function describeOutcome(o: Exclude<ReturnOutcome, { kind: "returned" }>): { tone: "muted" | "fail"; text: string } {
  switch (o.kind) {
    case "cancelled":
      return { tone: "muted", text: "Signature cancelled in your wallet. Nothing was sent." };
    case "not_sent":
      return { tone: "fail", text: `${clause(o.message)}. Nothing was sent.` };
    case "unknown":
      return { tone: "fail", text: `The return may have reached the chain; refresh to see (${o.message}).` };
  }
}

type Notice = { tone: "muted" | "fail"; text: string };

/**
 * "Return remainder" for the campaign's dispute resolver. The server reads
 * the balance and the funder from chain and builds the one transfer; this
 * shows both before the wallet is asked, then signs in the resolver's own
 * wallet. The page is not reloaded after a return: the row would leave the
 * list, so the outcome stays here.
 */
export function RemainderReturn({ campaignId, resolver }: { campaignId: string; resolver: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "preparing" | "confirm" | "signing">("idle");
  const [prepared, setPrepared] = useState<PreparedReturn | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [done, setDone] = useState<{ txHash: string; amount: string } | null>(null);

  async function prepare() {
    setPhase("preparing");
    setNotice(null);
    try {
      setPrepared(await remainderCall<PreparedReturn>(campaignId, { action: "prepare" }));
      setPhase("confirm");
    } catch (e) {
      const text = message(e);
      setNotice({ tone: "fail", text: describePrepareFailure(text) });
      setPhase("idle");
      if (alreadyReturned(text)) router.refresh();
    }
  }

  async function signAndReturn(op: PreparedReturn) {
    setPhase("signing");
    setNotice(null);
    const outcome = await signAndSubmit(op, {
      sign: (xdr) => signTransaction(resolver, xdr),
      submit: (body) => remainderCall<{ txHash: string }>(campaignId, { action: "submit", ...body }),
    });
    if (outcome.kind === "returned") {
      setDone({ txHash: outcome.txHash, amount: op.amount });
      return;
    }
    setNotice(describeOutcome(outcome));
    // A cancel or a refusal before sending leaves the same transaction to sign again; an unknown answer does not.
    setPhase(outcome.kind === "unknown" ? "idle" : "confirm");
    if (outcome.kind === "unknown") setPrepared(null);
  }

  if (done) {
    return (
      <div role="status" className="space-y-2.5">
        <Pill tone="pass">Settled</Pill>
        <p className="text-sm text-text-2">{formatUsdc(done.amount)} returned to the funder, less the Trustless Work protocol fee.</p>
        <HashChip value={done.txHash} href={publicEnv.explorerTxUrl(done.txHash)} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {prepared && (phase === "confirm" || phase === "signing") ? (
        <div className="rounded-lg border border-line-strong bg-sunken p-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <span className="font-semibold text-text">{formatUsdc(prepared.amount)}</span>
            <span aria-hidden="true" className="text-muted">
              →
            </span>
            <span className="sr-only">to</span>
            <HashChip value={prepared.funder} head={4} tail={4} href={publicEnv.explorerAccountUrl(prepared.funder)} />
            <span className="text-text-2">(the funder)</span>
          </p>
          <p className="mt-2 text-[13px] leading-normal text-text-2">
            The whole escrow balance, read from Stellar just now, goes to the wallet that funded the campaign, less the Trustless
            Work protocol fee. Your wallet shows the transaction before you sign.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button size="sm" busy={phase === "signing"} busyLabel="Waiting for wallet…" onClick={() => void signAndReturn(prepared)}>
              Sign and return
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={phase === "signing"}
              onClick={() => {
                setPhase("idle");
                setPrepared(null);
                setNotice(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" busy={phase === "preparing"} busyLabel="Reading the escrow…" onClick={() => void prepare()}>
          Return remainder
        </Button>
      )}
      {notice ? (
        <p role={notice.tone === "fail" ? "alert" : "status"} className={notice.tone === "fail" ? "text-sm text-fail" : "text-sm text-muted"}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
