import { StrKey } from "@stellar/stellar-sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { amount, netOfFee } from "@/components/site/amount";
import { axes, FONT } from "@/components/site/type";
import { HashChip } from "@/components/ui/hash-chip";
import { publicEnv } from "@/config/public-env";
import { formatDateShort } from "@/lib/format";
import { publicProfile } from "@/services/profile";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pubkey: string }> };

/** One read per request, shared by the metadata and the page. Null for a malformed key, as for a wallet without a name. */
const load = cache(async (pubkey: string) => (StrKey.isValidEd25519PublicKey(pubkey) ? publicProfile(pubkey) : null));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await load((await params).pubkey);
  if (!p) return { title: "Profile not found" };
  return {
    title: p.displayName,
    description: p.bio ?? `${p.displayName} on Proofwork: approved work and USDC payouts on ${publicEnv.networkName}.`,
  };
}

/**
 * A contributor's public page: name, bio, X account, approved work and the
 * payouts that reached this wallet. Only exists once the wallet saved a
 * display name. Telegram, city and country are never read here.
 */
export default async function PublicProfilePage({ params }: Params) {
  const { pubkey } = await params;
  const p = await load(pubkey);
  if (!p) notFound();

  return (
    <div className="bg-canvas text-white">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-32 sm:px-6 md:pt-40">
        <p className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55">
          <span>Contributor on {publicEnv.networkName}</span>
          <HashChip value={p.pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(p.pubkey)} className="normal-case tracking-normal" />
        </p>
        <h1 className={`mt-5 max-w-5xl text-[clamp(3rem,9vw,7.5rem)] leading-[0.86] [overflow-wrap:anywhere] ${FONT}`} style={{ fontVariationSettings: axes(72, 900) }}>
          <span className="inline-block animate-rise">{p.displayName}</span>
          <span className="text-accent">.</span>
        </h1>
        {p.bio ? <p className="mt-6 max-w-2xl animate-reveal whitespace-pre-line text-[18px] leading-relaxed text-white/70 [overflow-wrap:anywhere]">{p.bio}</p> : null}
        {p.xUrl ? (
          <a
            href={p.xUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold transition-colors hover:bg-white hover:text-black"
          >
            X account <span aria-hidden="true">↗</span>
          </a>
        ) : null}

        <dl className="mt-14 grid max-w-2xl grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3">
          <Stat label="Approved posts" value={String(p.approvedCount)} />
          <Stat label="Payouts" value={String(p.payoutCount)} />
          <Stat label="USDC received, net of fee" value={amount(netOfFee(p.paidAmount))} />
        </dl>

        <section aria-labelledby="work-title" className="mt-16">
          <h2 id="work-title" className={`text-[clamp(2.2rem,5vw,3.75rem)] leading-[0.9] ${FONT}`} style={{ fontVariationSettings: axes(80, 880) }}>
            Approved work
          </h2>
          {p.submissions.length === 0 ? (
            <p className="mt-6 rounded-[24px] border border-dashed border-white/15 px-6 py-10 text-white/60">No approved posts yet.</p>
          ) : (
            <ul className="mt-6 border-t border-white/15">
              {p.submissions.map((s) => (
                <li key={s.workUrl} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 py-4">
                  <span className="min-w-0">
                    <Link href={`/c/${s.campaignSlug}`} className="block rounded-sm font-semibold [overflow-wrap:anywhere] hover:underline">
                      {s.campaignTitle}
                    </Link>
                    <span className="block font-mono text-[12px] text-white/55">Submitted {formatDateShort(s.submittedAt)}</span>
                  </span>
                  <a
                    href={s.workUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/15 px-4 text-[13px] font-semibold transition-colors hover:bg-white hover:text-black"
                  >
                    View the post <span aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="paid-title" className="bg-accent px-5 py-16 text-black sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 id="paid-title" className={`text-[clamp(2.2rem,5vw,3.75rem)] leading-[0.9] ${FONT}`} style={{ fontVariationSettings: axes(80, 900) }}>
            Payouts
          </h2>
          {p.payouts.length === 0 ? (
            <p className="mt-6 text-lg">No payouts yet. Each one shows up here with its transaction.</p>
          ) : (
            <ul className="mt-8 border-t-2 border-black">
              {p.payouts.map((x) => (
                <li key={x.releaseTxHash} className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2 border-b border-black/20 py-4 sm:grid-cols-[8rem_1fr_auto]">
                  <span className={`text-4xl leading-none ${FONT}`} style={{ fontVariationSettings: axes(70, 900) }}>
                    +{amount(netOfFee(x.amount))}
                  </span>
                  <span className="min-w-0">
                    <Link href={`/c/${x.campaignSlug}`} className="block truncate rounded-sm font-semibold hover:underline">
                      {x.campaignTitle}
                    </Link>
                    <span className="block text-sm text-black/65">USDC received after the 0.3% fee · {formatDateShort(x.releasedAt)}</span>
                  </span>
                  <HashChip value={x.releaseTxHash} href={publicEnv.explorerTxUrl(x.releaseTxHash)} className="col-span-2 w-fit sm:col-span-1" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">{label}</dt>
      <dd className={`text-[clamp(2.75rem,5vw,4rem)] leading-[0.85] ${FONT}`} style={{ fontVariationSettings: axes(62, 900) }}>
        {value}
      </dd>
    </div>
  );
}
