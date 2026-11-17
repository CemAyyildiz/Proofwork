import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HashCheck } from "@/components/hash-check";
import { Stamp } from "@/components/site/stamp";
import { axes, FONT } from "@/components/site/type";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import { SIGNALS } from "@/domain/rubric";
import { formatDateShort } from "@/lib/format";
import { rubricVersionOf, storedLedgerValue } from "@/ledger/canonical";
import { getDecision } from "@/services/review";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Decision record",
  description: `A review decision on Proofwork, checkable against its hash on ${publicEnv.networkName}.`,
};

/** A dashed rule across the receipt, like the tear lines on a till slip. */
function Tear() {
  return <hr aria-hidden="true" className="my-6 border-0 border-t-2 border-dashed border-black/20" />;
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
  const rubric = rubricVersionOf(d.canonicalJson);
  const words = ["Don’t", "take", "our", "word."];

  return (
    <div className="bg-canvas px-5 pb-24 pt-32 text-white sm:px-6 md:pt-36">
      <div className="mx-auto max-w-6xl">
        <p className="animate-reveal font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">Public decision record · no account needed</p>
        <h1 className={`mt-5 max-w-5xl text-[clamp(3rem,8vw,7rem)] leading-[0.86] ${FONT}`} style={{ fontVariationSettings: axes(78, 900) }}>
          {words.map((w, i) => (
            <span key={w} className="mr-[0.22em] inline-block overflow-y-clip pb-[0.06em] align-top">
              <span className="inline-block animate-rise" style={{ animationDelay: `${80 + i * 60}ms` }}>
                {w}
              </span>
            </span>
          ))}
          <span className="inline-block overflow-y-clip pb-[0.06em] align-top">
            <span className="inline-block animate-rise text-accent" style={{ animationDelay: "360ms" }}>
              Check it.
            </span>
          </span>
        </h1>
        <p className="mt-6 max-w-2xl animate-reveal text-[17px] leading-relaxed text-white/60 [animation-delay:400ms]">
          {d.txHash
            ? `This decision was written to ${publicEnv.networkName} when it was made. Your browser rebuilds the proof below from scratch.`
            : "This decision is recorded but not yet committed to Stellar. Your browser can still check the record against its hash."}
        </p>

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* The receipt */}
          <article
            aria-label="Decision"
            className="relative min-w-0 animate-reveal rounded-t-[28px] bg-paper px-6 pb-12 pt-7 text-paper-ink [animation-delay:200ms] [mask-image:radial-gradient(circle_at_10px_100%,transparent_9px,#000_9.5px)] [mask-position:-10px_0] [mask-size:20px_100%] [mask-repeat:repeat-x] sm:px-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-black/55">
              <span>Decision record · {s.shortId}</span>
              <span className="flex flex-wrap gap-2">
                {d.txHash ? (
                  <span className="rounded-full bg-black px-2.5 py-1 text-accent">● On Stellar</span>
                ) : (
                  <span className="rounded-full border border-black/25 px-2.5 py-1">Not on-chain yet</span>
                )}
                {d.appealOf ? <span className="rounded-full border border-black/25 px-2.5 py-1">Re-review</span> : null}
              </span>
            </div>

            <div className="mt-6 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-black/55">Campaign</p>
                <p className={`mt-1 text-[clamp(1.5rem,2.6vw,2rem)] leading-[1] [overflow-wrap:anywhere] ${FONT}`} style={{ fontVariationSettings: axes(88, 800) }}>
                  {c.title}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className={`text-[6rem] leading-[0.8] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
                  {passed}
                  <span className="text-black/25">/{SIGNALS.length}</span>
                </p>
                <p className="mt-2 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-black/60">
                  {d.reasonCode} · {rubric ? `Rubric ${rubric}` : "Rubric unknown"}
                </p>
              </div>
              <Stamp outcome={pass ? "PASS" : "FAIL"} delay={1100} className="mb-3 mr-2" />
              <span className="sr-only">Outcome: {d.outcome}</span>
            </div>

            <Tear />

            <ul aria-label="Signals" className="grid">
              {SIGNALS.map((sg, i) => {
                const ok = signals[sg.id] === true;
                return (
                  <li
                    key={sg.id}
                    style={{ animationDelay: `${450 + i * 90}ms` }}
                    className="flex animate-reveal items-center gap-4 border-b border-black/10 py-3 last:border-0"
                  >
                    <span className={`w-7 shrink-0 text-xl leading-none text-black/25 ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={cx("flex-1 text-[15.5px] font-semibold", !ok && "text-black/55")}>{sg.label}</span>
                    <span
                      className={cx(
                        "rounded-full px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.08em]",
                        ok ? "bg-black text-accent" : "bg-fail text-black",
                      )}
                    >
                      {ok ? "YES" : "NO"}
                      <span className="sr-only">{ok ? " (pass)" : " (fail)"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {d.note ? (
              <>
                <Tear />
                <figure>
                  <figcaption className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/50">Reviewer&rsquo;s reason</figcaption>
                  <blockquote className={`mt-3 text-[clamp(1.2rem,2vw,1.5rem)] leading-snug [overflow-wrap:anywhere] ${FONT}`} style={{ fontVariationSettings: axes(95, 600) }}>
                    &ldquo;{d.note}&rdquo;
                  </blockquote>
                </figure>
              </>
            ) : null}

            <Tear />

            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              <Kv label="Submission">
                <span className="font-mono">{s.shortId}</span>
              </Kv>
              <Kv label="Decided">
                <span className="font-mono">{formatDateShort(d.decidedAt)}</span>
              </Kv>
              <Kv label="Reviewer">
                <HashChip value={d.reviewerPubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(d.reviewerPubkey)} className="whitespace-nowrap" />
              </Kv>
              <Kv label="The post">
                <a href={s.workUrl} target="_blank" rel="noreferrer" className="rounded-sm font-semibold underline decoration-black/30 underline-offset-4 hover:decoration-black">
                  View the post on X ↗
                </a>
              </Kv>
            </dl>

            <Tear />

            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/50">On-chain record</h2>
            <dl className="mt-3 grid">
              <OnChainRow label="Ledger key">
                <HashChip value={d.ledgerKey} head={12} tail={6} />
              </OnChainRow>
              <OnChainRow label="Ledger value">
                {/* What ledgerValue() in src/ledger/canonical.ts wrote as the manage_data value; its prefix is the record version. */}
                <HashChip value={storedLedgerValue(d)} head={48} tail={0} className="max-w-full whitespace-nowrap" />
              </OnChainRow>
              <OnChainRow label="Memo hash">
                <HashChip value={d.decisionHash} />
              </OnChainRow>
              <OnChainRow label="Transaction">
                {d.txHash ? <HashChip value={d.txHash} href={publicEnv.explorerTxUrl(d.txHash)} /> : <span className="text-[13px] font-semibold text-fail">Not committed on-chain yet.</span>}
              </OnChainRow>
            </dl>
          </article>

          {/* The proof */}
          <section aria-labelledby="proof-title" className="min-w-0 animate-reveal rounded-[28px] border border-white/10 bg-[#111] p-6 [animation-delay:320ms] sm:p-8 lg:sticky lg:top-24">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">Runs on your device</p>
            <h2 id="proof-title" className={`mt-2 text-[clamp(1.9rem,3vw,2.6rem)] leading-[0.95] ${FONT}`} style={{ fontVariationSettings: axes(85, 850) }}>
              Proof, <span className="text-accent">rebuilt in your browser.</span>
            </h2>
            <HashCheck canonicalJson={d.canonicalJson} expectedHash={d.decisionHash} txHash={d.txHash} />
            <p className="mt-6 border-t border-white/10 pt-5 text-sm text-white/50">
              From{" "}
              <Link href={`/c/${c.slug}`} className="rounded-sm font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                {c.title}
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-black/50">{label}</dt>
      <dd className="mt-1.5 text-[14px] font-medium">{children}</dd>
    </div>
  );
}

function OnChainRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-black/10 py-3 last:border-0">
      <dt className="text-[13px] text-black/55">{label}</dt>
      <dd className="min-w-0 max-w-full overflow-x-auto">{children}</dd>
    </div>
  );
}
