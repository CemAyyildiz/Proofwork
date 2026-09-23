import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HashCheck } from "@/components/hash-check";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Eyebrow } from "@/components/ui/eyebrow";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill } from "@/components/ui/pill";
import { publicEnv } from "@/config/public-env";
import { SIGNALS } from "@/domain/rubric";
import { formatDateShort } from "@/lib/format";
import { getDecision } from "@/services/review";

export const dynamic = "force-dynamic";

/** Staggered rise-in on load; CSS only, final state under reduced motion. */
function rise(i: number): React.CSSProperties {
  return { animationDelay: `${i * 80}ms` };
}

/**
 * Public verification page. Everything needed to check the decision without
 * trusting this server: the canonical JSON, its hash, the transaction that
 * carries that hash as memo, and a browser-side recomputation.
 */
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getDecision(id);
  if (!row) notFound();
  const { d, s, c } = row;
  const signals = d.signals as Record<string, boolean>;
  const passed = SIGNALS.filter((sg) => signals[sg.id] === true).length;
  const pass = d.outcome === "PASS";

  return (
    <div className="mx-auto max-w-[1180px] pb-24 pt-4 md:pt-6">
      <Eyebrow className="animate-reveal">Public decision record · no account needed</Eyebrow>
      <h1 style={rise(1)} className="mt-5 animate-reveal text-[clamp(40px,5.4vw,76px)] font-semibold leading-[0.96] tracking-[-0.05em]">
        Don&apos;t take our word. <span className="font-serif font-normal italic tracking-[-0.02em] text-accent">Check it.</span>
      </h1>
      <p style={rise(2)} className="mt-[18px] max-w-[640px] animate-reveal text-[17px] leading-[1.55] text-text-2">
        {d.txHash
          ? "This decision was written to Stellar testnet when it was made. Your browser rebuilds the proof below from scratch."
          : "This decision is recorded but not yet committed to Stellar. Your browser can still check the record against its hash."}
      </p>

      <div className="mt-11 grid items-start gap-[18px] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div style={rise(3)} className="grid min-w-0 animate-reveal gap-[18px]">
          <Card className="overflow-hidden p-6 md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={cx("text-[68px] font-semibold leading-[0.9] tracking-[-0.06em] md:text-[88px]", pass ? "text-pass" : "text-fail")}>
                  {d.outcome}
                </p>
                <p className="mt-2.5 font-mono text-[13px] font-medium text-muted">
                  {d.reasonCode} · {passed} of {SIGNALS.length} signals
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {d.txHash ? <Pill tone="chain">On Stellar</Pill> : <Pill tone="wait">Not on-chain yet</Pill>}
                {d.appealOf ? <Pill tone="wait">Re-review</Pill> : null}
              </div>
            </div>

            <ul className="mt-6 grid gap-1.5" aria-label="Signals">
              {SIGNALS.map((sg, i) => {
                const ok = signals[sg.id] === true;
                return (
                  <li
                    key={sg.id}
                    style={{ animationDelay: `${400 + i * 50}ms` }}
                    className={cx(
                      "flex animate-reveal items-center justify-between gap-3 rounded-md border bg-sunken px-3.5 py-3 text-[14.5px]",
                      ok ? "border-line" : "border-fail-line bg-fail-soft",
                    )}
                  >
                    {sg.label}
                    <span className={cx("font-mono text-[11.5px] font-medium tracking-[0.06em]", ok ? "text-pass" : "text-fail")}>
                      {ok ? "PASS" : "FAIL"}
                    </span>
                  </li>
                );
              })}
            </ul>

            {d.note ? (
              <figure className="mt-5">
                <figcaption className="text-xs text-muted">Reviewer note</figcaption>
                <blockquote className="mt-1.5 rounded-md border border-line bg-sunken px-3.5 py-3 text-sm leading-normal text-text-2 [overflow-wrap:anywhere]">
                  {d.note}
                </blockquote>
              </figure>
            ) : null}

            <dl className="mt-[18px] grid grid-cols-2 overflow-hidden rounded-[14px] border border-line">
              <Kv label="Submission">
                <span className="font-mono">{s.shortId}</span>
              </Kv>
              <Kv label="Campaign" border="left">
                <span className="[overflow-wrap:anywhere]">{c.title}</span>
              </Kv>
              <Kv label="Reviewer" border="top">
                <HashChip value={d.reviewerPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(d.reviewerPubkey)} className="whitespace-nowrap" />
              </Kv>
              <Kv label="Decided" border="both">
                <span className="font-mono">{formatDateShort(d.decidedAt)}</span>
              </Kv>
            </dl>
            <a
              href={s.workUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-sm text-[13.5px] font-medium text-text-2 underline decoration-line-strong underline-offset-[3px] hover:text-text"
            >
              View the post on X ↗
            </a>
          </Card>

          <Card className="overflow-hidden">
            <h2 className="sr-only">On-chain record</h2>
            <OnChainRow label="Ledger key">
              <HashChip value={d.ledgerKey} head={12} tail={6} />
            </OnChainRow>
            <OnChainRow label="Memo hash">
              <HashChip value={d.decisionHash} />
            </OnChainRow>
            <OnChainRow label="Transaction" last>
              {d.txHash ? (
                <HashChip value={d.txHash} href={publicEnv.explorerTxUrl(d.txHash)} />
              ) : (
                <span className="text-[13px] text-fail">Not committed on-chain yet.</span>
              )}
            </OnChainRow>
          </Card>
        </div>

        <Card glow style={rise(4)} className="min-w-0 animate-reveal p-6 md:p-7">
          <h2 className="text-[26px] font-semibold tracking-[-0.035em]">
            Proof, <span className="font-serif font-normal italic tracking-[-0.02em] text-accent">rebuilt in your browser</span>
          </h2>
          <HashCheck canonicalJson={d.canonicalJson} expectedHash={d.decisionHash} txHash={d.txHash} />
        </Card>
      </div>
    </div>
  );
}

function Kv({ label, border, children }: { label: string; border?: "left" | "top" | "both"; children: ReactNode }) {
  return (
    <div
      className={cx(
        "min-w-0 px-3.5 py-[13px]",
        (border === "left" || border === "both") && "border-l border-line",
        (border === "top" || border === "both") && "border-t border-line",
      )}
    >
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1.5 text-[13px] font-medium">{children}</dd>
    </div>
  );
}

function OnChainRow({ label, last = false, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1.5 px-[22px] py-[15px]", !last && "border-b border-line")}>
      <span className="text-[13px] text-muted">{label}</span>
      {children}
    </div>
  );
}
