import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Pipeline } from "@/components/landing/pipeline";
import { ProofCard } from "@/components/landing/proof-card";
import { Magnetic, Reveal } from "@/components/landing/reveal";
import { RubricPlayground } from "@/components/landing/rubric-playground";
import { Statement } from "@/components/landing/statement";
import { VerifyPlayground } from "@/components/landing/verify-playground";
import { EVIDENCE_TXS } from "@/components/landing/evidence";
import { buttonClasses } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { LogoMark } from "@/components/ui/logo";
import { PASS_THRESHOLD, SIGNALS } from "@/domain/rubric";
import { currentUser } from "@/lib/current-user";
import { truncateMiddle } from "@/lib/format";

export const dynamic = "force-dynamic";

const serif = "font-serif font-normal italic tracking-[-0.02em] text-accent";
const h2Class = "mt-[22px] text-[clamp(40px,4.4vw,72px)] font-semibold leading-[0.98] tracking-[-0.05em]";

function Kicker({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return (
    <p className={cx("flex items-center gap-3 font-mono text-xs font-medium uppercase tracking-[0.16em] text-muted", center && "justify-center")}>
      <span aria-hidden="true" className="h-px w-7 bg-accent" />
      {children}
    </p>
  );
}

/** Headline words rise out of their line mask, staggered. CSS only. */
function MaskLine({ words, start }: { words: ReactNode[]; start: number }) {
  return (
    <span className="block overflow-hidden pb-[0.06em]">
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="inline-block animate-rise" style={{ animationDelay: `${150 + (start + i) * 80}ms` }}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

function Check({ ok = true }: { ok?: boolean }) {
  return ok ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 stroke-pass" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" className="mt-0.5 shrink-0 stroke-fail" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

const ROLES: ReadonlyArray<{ name: string; icon: ReactNode; can: string[]; cannot: string[]; highlight?: boolean }> = [
  {
    name: "Funder",
    highlight: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-ink" aria-hidden="true">
        <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" />
        <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
        <circle cx="17" cy="14" r="1.5" />
      </svg>
    ),
    can: ["Funds the escrow", "Signs every release, the final approval", "Gets the remainder back at the deadline"],
    cannot: [],
  },
  {
    name: "Proofwork keys",
    icon: <LogoMark className="h-[22px] w-[22px]" />,
    can: ["Add a milestone per approved submission", "Write decision records to Stellar"],
    cannot: ["Cannot release or move funds"],
  },
  {
    name: "Neutral resolver",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-text" aria-hidden="true">
        <path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z" />
      </svg>
    ),
    can: ["Returns what's left to the funder"],
    cannot: ["Cannot pay anyone else"],
  },
];

const FACTS: ReadonlyArray<{ value: number; label: string; accent?: boolean }> = [
  { value: SIGNALS.length, label: "signals scored per submission" },
  { value: PASS_THRESHOLD, label: "needed to pass" },
  { value: 1, label: "re-review per rejection, while the campaign is open" },
  { value: 0, label: "funds held by Proofwork", accent: true },
];

export default async function Home() {
  const user = await currentUser();
  const cta = user?.roles.has("funder") ? (
    <Magnetic>
      <Link href="/campaigns" className={buttonClasses("primary")}>
        Open your campaigns <span aria-hidden="true">→</span>
      </Link>
    </Magnetic>
  ) : user?.roles.has("reviewer") ? (
    <Magnetic>
      <Link href="/review" className={buttonClasses("primary")}>
        Open the review queue <span aria-hidden="true">→</span>
      </Link>
    </Magnetic>
  ) : (
    <Magnetic>
      <Link href="/campaigns" className={buttonClasses("primary")}>
        Launch app <span aria-hidden="true">→</span>
      </Link>
    </Magnetic>
  );

  return (
    <div className="-mt-10">
      {/* Hero */}
      <header className="relative -mx-[18px] overflow-hidden px-[18px] md:-mx-10 md:px-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--color-line)_1px,transparent_1px),linear-gradient(90deg,var(--color-line)_1px,transparent_1px)] bg-size-[72px_72px] mask-[radial-gradient(ellipse_70%_70%_at_70%_45%,black_20%,transparent_75%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 top-0 h-[760px] w-[760px] animate-drift rounded-full bg-[radial-gradient(circle,var(--color-accent-line)_0%,var(--color-accent-soft)_35%,transparent_65%)] opacity-50 blur-[30px]"
        />
        <div className="relative grid items-center gap-12 pb-4 pt-16 lg:min-h-[calc(100vh-64px)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-[4vw] lg:pt-10">
          <div className="relative z-10 min-w-0">
            <p className="inline-flex animate-reveal flex-wrap items-center gap-2.5 rounded-full border border-line-strong bg-white/2 py-[7px] pl-2.5 pr-3.5 text-[13px] text-text-2">
              <span aria-hidden="true" className="h-2 w-2 animate-ping rounded-full bg-pass text-pass" />
              <b className="font-medium text-text">Live on Stellar testnet</b> · Stellar Instawards grantee
            </p>
            <h1 className="mt-[30px] text-[clamp(56px,7.4vw,124px)] font-semibold leading-[0.9] tracking-[-0.055em]">
              <MaskLine words={["Bounties", "you"]} start={0} />
              <MaskLine
                words={[
                  "can",
                  <span key="prove" className="font-serif text-[1.08em] font-normal italic tracking-[-0.03em] text-accent">
                    prove.
                  </span>,
                ]}
                start={2}
              />
            </h1>
            <p className="mt-[30px] max-w-[520px] animate-reveal text-[clamp(17px,1.35vw,20px)] leading-[1.55] text-text-2 [animation-delay:500ms]">
              Escrow-funded, reviewed by a person, settled on-chain. Every decision on Proofwork leaves a receipt that anyone can check,
              without trusting Proofwork.
            </p>
            <div className="mt-[38px] flex animate-reveal flex-wrap items-center gap-3 [animation-delay:580ms]">
              {cta}
              <a href="#verify" className={buttonClasses("secondary")}>
                Check a real decision
              </a>
            </div>
            <ul className="mt-[22px] flex animate-reveal flex-wrap gap-x-[18px] gap-y-2 text-[13px] text-muted [animation-delay:660ms]">
              <li className="flex items-center gap-[7px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" className="stroke-muted" aria-hidden="true">
                  <rect x="4" y="10" width="16" height="11" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                Non-custodial escrow
              </li>
              <li className="flex items-center gap-[7px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" className="stroke-muted" aria-hidden="true">
                  <path d="M12 2 4 6v6c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z" />
                </svg>
                Blind human review
              </li>
              <li className="flex items-center gap-[7px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" className="stroke-muted" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9 12h6M12 9v6" />
                </svg>
                Paid in USDC
              </li>
            </ul>
          </div>
          <div className="relative min-w-0 lg:py-16">
            <ProofCard />
          </div>
        </div>

        <div
          aria-label="Transactions from the recorded testnet run"
          className="relative mt-10 overflow-hidden border-y border-line mask-[linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]"
        >
          <div className="flex w-max animate-marquee gap-12 py-[18px]">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1 || undefined} className="flex gap-12">
                {EVIDENCE_TXS.map((tx) => (
                  <li key={tx.label} className="flex items-center gap-2.5 whitespace-nowrap font-mono text-[13px] text-muted">
                    <span aria-hidden="true" className="h-[5px] w-[5px] rounded-full bg-accent" />
                    <b className="font-medium uppercase tracking-[0.08em] text-text-2">{tx.label}</b>
                    <span title={tx.hash}>{truncateMiddle(tx.hash, 12, 6)}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </header>

      {/* Statement */}
      <section aria-label="Why Proofwork" className="py-[18vh]">
        <Kicker>Why Proofwork</Kicker>
        <Statement
          plain="Most bounty tools pay for what a machine can check. Proofwork pays for what only a person can judge,"
          serif="and makes that judgement public."
        />
      </section>

      {/* Pinned pipeline */}
      <Pipeline
        heading={
          <>
            <Kicker>How it works</Kicker>
            <h2 className={h2Class}>
              From budget to payout, <span className={serif}>on the record.</span>
            </h2>
          </>
        }
      />

      {/* Playgrounds */}
      <section id="rubric" aria-labelledby="play-title" className="pb-[10vh] pt-[18vh]">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end lg:gap-10">
          <Reveal>
            <Kicker>Interactive</Kicker>
            <h2 id="play-title" className={cx(h2Class, "max-w-[760px]")}>
              Try the rubric. <span className={serif}>Then check the proof.</span>
            </h2>
          </Reveal>
          <Reveal delay={80} className="max-w-[420px]">
            <p className="text-[17px] leading-[1.55] text-text-2">
              Both panels run the real thing: the same pass rule the reviewer uses, and a live SHA-256 over a decision that is actually on
              Stellar testnet.
            </p>
          </Reveal>
        </div>
        <div className="mt-14 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal className="min-w-0">
            <div className="h-full rounded-xxl border border-line bg-surface p-6 md:p-8">
              <h3 className="text-[26px] font-semibold tracking-[-0.035em]">Six signals, four to pass</h3>
              <p className="mt-2 max-w-[460px] text-[15px] leading-normal text-muted">
                Flip any signal. A person makes this call for every submission, and the outcome and the reason go on-chain.
              </p>
              <RubricPlayground />
            </div>
          </Reveal>
          <Reveal delay={80} className="min-w-0">
            <div id="verify" className="h-full scroll-mt-24 rounded-xxl border border-line bg-surface p-6 md:p-8">
              <h3 className="text-[26px] font-semibold tracking-[-0.035em]">
                Don&apos;t trust us. <span className={serif}>Check.</span>
              </h3>
              <p className="mt-2 max-w-[460px] text-[15px] leading-normal text-muted">
                This is a real decision record from the testnet run. Your browser hashes it; compare with the memo on the transaction.
              </p>
              <VerifyPlayground />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Custody */}
      <section id="custody" aria-labelledby="custody-title" className="py-[14vh]">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end lg:gap-10">
          <Reveal>
            <Kicker>Custody</Kicker>
            <h2 id="custody-title" className={h2Class}>
              Who can move the money? <span className={serif}>Not Proofwork.</span>
            </h2>
          </Reveal>
          <Reveal delay={80} className="max-w-[420px]">
            <p className="text-[17px] leading-[1.55] text-text-2">
              Roles are fixed on the escrow contract when it is deployed. Proofwork&apos;s keys can add and approve milestones. They cannot send
              funds anywhere.
            </p>
          </Reveal>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {ROLES.map((r, i) => (
            <Reveal key={r.name} delay={i * 80}>
              <div
                className={cx(
                  "flex h-full min-h-[300px] flex-col rounded-[24px] border p-7",
                  r.highlight ? "border-accent-line bg-linear-180 from-accent-soft to-surface to-60%" : "border-line bg-surface",
                )}
              >
                <span
                  className={cx(
                    "grid h-12 w-12 place-items-center rounded-[14px] border",
                    r.highlight ? "border-accent bg-accent" : "border-line-strong bg-white/3",
                  )}
                >
                  {r.icon}
                </span>
                <h3 className="mt-6 text-[22px] font-semibold tracking-[-0.03em]">{r.name}</h3>
                <ul className="mt-[18px] grid gap-2.5">
                  {r.can.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-[15px] leading-[1.4] text-text-2">
                      <Check />
                      {t}
                    </li>
                  ))}
                  {r.cannot.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-[15px] leading-[1.4] text-muted">
                      <Check ok={false} />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[24px] border border-line md:grid-cols-4">
            {FACTS.map((f, i) => (
              <div
                key={f.label}
                className={cx(
                  "bg-surface px-6 py-7 md:px-7 md:py-[30px]",
                  i % 2 === 1 && "border-l border-line",
                  i >= 2 && "border-t border-line md:border-t-0",
                  i === 2 && "md:border-l",
                )}
              >
                <p className={cx("text-[56px] font-semibold leading-none tracking-[-0.06em] md:text-[64px]", f.accent && "text-accent")}>{f.value}</p>
                <p className="mt-2.5 text-sm text-muted">{f.label}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* End CTA */}
      <section aria-labelledby="end-title" className="relative -mx-[18px] overflow-hidden px-[18px] pt-[20vh] text-center md:-mx-10 md:px-10">
        <Reveal>
          <Kicker center>Stellar testnet · live now</Kicker>
          <h2 id="end-title" className="mt-[26px] text-[clamp(56px,8vw,140px)] font-semibold leading-[0.92] tracking-[-0.06em]">
            Proof over <span className={serif}>promises.</span>
          </h2>
          <p className="mt-[26px] text-lg text-text-2">Run a campaign where every payout can be checked.</p>
          <div className="mt-[38px] flex flex-wrap items-center justify-center gap-3">
            {cta}
            <a href="https://x.com/proofworkapp" target="_blank" rel="noreferrer" className={buttonClasses("secondary")}>
              Follow @proofworkapp ↗
            </a>
          </div>
        </Reveal>
        <p
          aria-hidden="true"
          className="mt-[16vh] select-none whitespace-nowrap text-[min(19vw,250px)] font-bold leading-[0.75] tracking-[-0.07em] text-transparent [-webkit-text-stroke:1px_var(--color-line-strong)]"
        >
          Proofwork
        </p>
      </section>

      <footer className="-mx-[18px] -mb-10 flex flex-col justify-between gap-3 border-t border-line px-[18px] py-[26px] text-[13px] text-muted md:-mx-10 md:flex-row md:gap-5 md:px-10">
        <span>© 2026 Proofwork · Stellar Instawards grantee</span>
        <span className="max-w-[560px] md:text-right">
          Independent software, not affiliated with, sponsored or endorsed by the Stellar Development Foundation. Testnet only.
        </span>
      </footer>
    </div>
  );
}
