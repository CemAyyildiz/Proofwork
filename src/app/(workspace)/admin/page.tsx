import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminAccess } from "@/components/admin-access";
import { SignedOut } from "@/components/signed-out";
import { HashChip } from "@/components/ui/hash-chip";
import { OWNER_LABEL, StagePill } from "@/components/workspace/campaign-phase";
import { ax, Label } from "@/components/workspace/kit";
import { CountUp } from "@/components/workspace/motion-bits";
import { PageHeader } from "@/components/workspace/page-header";
import { RemainderReturn } from "@/components/workspace/remainder-return";
import { publicEnv } from "@/config/public-env";
import { db } from "@/db/client";
import type { Campaign } from "@/db/schema";
import { currentUser } from "@/lib/current-user";
import { isAppError } from "@/lib/errors";
import { formatDate, formatDateShort, formatTimestamp } from "@/lib/format";
import { accessOverview, awaitingReturn, campaignsOverview, LOG_LIMIT, PENDING_LIMIT, type CampaignOverviewRow } from "@/services/access";

export const dynamic = "force-dynamic";

/** A service read the session wallet may not make: null, so the page leaves that section out. */
async function opsOnly<T>(read: Promise<T>): Promise<T | null> {
  return read.catch((e: unknown) => {
    if (isAppError(e) && e.code === "FORBIDDEN") return null;
    throw e;
  });
}

/**
 * Operator page: every campaign and whose step it waits on, and funder
 * access. A wallet that is the dispute resolver of a closed campaign sees
 * only the campaigns whose remainder waits on it.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const now = new Date();
  // The services decide who may read what. A wallet with nothing here gets the same page as a wrong URL.
  const access = await opsOnly(accessOverview(user, db));
  const overview = await opsOnly(campaignsOverview(user, db, now));
  const awaiting = await awaitingReturn(user, db);
  const ops = access !== null && overview !== null;
  if (!ops && awaiting.length === 0) notFound();

  const wallet = (
    <span className="flex flex-wrap items-center gap-2">
      <span>Signed in with</span>
      <HashChip value={user.pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(user.pubkey)} />
    </span>
  );

  return (
    <div className="space-y-12">
      <PageHeader eyebrow={ops ? "Operator" : "Dispute resolver"} title={ops ? "Admin" : "Remainder returns"} description={wallet} />

      {ops ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 border-y border-white/[0.07] py-7 md:grid-cols-4">
          <Figure value={access.pending.length} label={access.pendingCut ? "requests shown, more waiting" : "requests waiting"} yellow={access.pending.length > 0} />
          <Figure value={awaiting.length} label="remainders to return" yellow={awaiting.length > 0} />
          <Figure value={overview.length} label="campaigns" />
          <Figure value={access.funders.length} label="funders" />
        </div>
      ) : null}

      {awaiting.length > 0 ? (
        <Section
          id="awaiting"
          title="Awaiting your return"
          count={awaiting.length}
          description="This wallet is the dispute resolver of these closed campaigns. Returning sends what is left in each escrow to its funder; you sign in your own wallet."
        >
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {awaiting.map((c) => (
              <li key={c.id}>
                <AwaitingRow campaign={c} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {overview ? (
        <Section id="campaigns" title="Campaigns" count={overview.length} description="Every campaign, its stage and whose step it waits on.">
          {overview.length === 0 ? <p className="rounded-[22px] border border-dashed border-white/12 px-5 py-8 text-sm text-white/45">No campaigns yet.</p> : <CampaignsTable rows={overview} />}
        </Section>
      ) : null}

      {access ? (
        <Section
          id="access"
          title="Funder access"
          description="Approve or reject requests and revoke access. Every grant and revocation is written to the access log; a rejection changes no role and stays on the request."
        >
          <AdminAccess
            pending={access.pending.map((r) => ({ id: r.id, pubkey: r.pubkey, team: r.team, note: r.note, requestedAt: formatDate(r.createdAt) }))}
            funders={access.funders.map((f) => ({ pubkey: f.pubkey, team: f.team, grantedAt: formatDate(f.grantedAt) }))}
            log={access.log.map((e) => ({ id: e.id, pubkey: e.pubkey, role: e.role, action: e.action, actor: e.actorPubkey, via: e.via, campaignId: e.campaignId, at: formatTimestamp(e.at) }))}
            pendingCut={access.pendingCut ? PENDING_LIMIT : null}
            logCut={access.logCut ? LOG_LIMIT : null}
          />
        </Section>
      ) : null}
    </div>
  );
}

function Section({ id, title, count, description, children }: { id: string; title: string; count?: number; description: string; children: ReactNode }) {
  const headingId = `${id}-heading`;
  return (
    <section className="space-y-5" aria-labelledby={headingId}>
      <div className="max-w-[760px]">
        <h2 id={headingId} className="flex items-baseline gap-3 font-display text-[clamp(1.9rem,3.4vw,2.75rem)] leading-none" style={{ fontVariationSettings: ax(85, 840) }}>
          {title}
          {count !== undefined ? <span className="text-white/25">{count}</span> : null}
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-white/55">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** One big figure in the operator's summary row. */
function Figure({ value, label, yellow = false }: { value: number; label: string; yellow?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`font-display text-[clamp(2.75rem,5.5vw,4.5rem)] leading-[0.8] ${yellow ? "text-accent" : value === 0 ? "text-white/25" : "text-text"}`} style={{ fontVariationSettings: ax(62, 900) }}>
        <CountUp value={String(value)} />
      </p>
      <Label className="mt-3 tracking-[0.14em]">{label}</Label>
    </div>
  );
}

function Wallet({ pubkey }: { pubkey: string }) {
  return <HashChip value={pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(pubkey)} />;
}

/** One closed campaign whose remainder waits on this wallet. */
function AwaitingRow({ campaign: c }: { campaign: Campaign }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 rounded-[28px] border border-accent/30 bg-[#0d0d0d] p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start md:p-7">
      <div className="min-w-0 space-y-3">
        <StagePill stage="closed_awaiting_return" />
        <h3 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] leading-[0.95] [overflow-wrap:anywhere]" style={{ fontVariationSettings: ax(88, 800) }}>
          {c.title}
        </h3>
        <p className="font-mono text-[12px] text-white/45">Closed {c.closedAt ? formatDateShort(c.closedAt) : "—"}</p>
        <dl className="space-y-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-white/45">Funder</dt>
            <dd>
              <Wallet pubkey={c.funderPubkey} />
            </dd>
          </div>
          {c.escrowContractId ? (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-white/45">Escrow</dt>
              <dd>
                <HashChip value={c.escrowContractId} href={publicEnv.explorerContractUrl(c.escrowContractId)} />
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="min-w-0 md:justify-self-end">
        <RemainderReturn campaignId={c.id} resolver={c.disputeResolverPubkey} />
      </div>
    </div>
  );
}

const th = "whitespace-nowrap px-4 py-3 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/40 first:pl-6";
const td = "whitespace-nowrap px-4 py-4 align-top first:pl-6";

/** Every campaign. A narrow screen scrolls the table sideways rather than wrapping wallets and pills. */
function CampaignsTable({ rows }: { rows: CampaignOverviewRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/[0.07] bg-[#0d0d0d] [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-white/[0.02]">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Campaign</th>
            <th scope="col" className={th}>Funder</th>
            <th scope="col" className={th}>Stage</th>
            <th scope="col" className={th}>Deadline</th>
            <th scope="col" className={th}>Waits on</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ campaign: c, stage, step }) => (
            <tr key={c.id} className="border-t border-line">
              <td className="min-w-[14rem] py-4 pl-6 pr-4 align-top">
                <p className="font-semibold [overflow-wrap:anywhere]">{c.title}</p>
                <p className="mt-0.5 font-mono text-[11.5px] text-white/40">{c.slug}</p>
              </td>
              <td className={td}>
                <Wallet pubkey={c.funderPubkey} />
              </td>
              <td className={td}>
                <StagePill stage={stage} />
              </td>
              <td className={`${td} font-mono text-[12px] text-white/60`}>{formatDateShort(c.deadlineAt)}</td>
              <td className={td}>
                {step.owner ? (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{OWNER_LABEL[step.owner]}</span>
                    {step.owner === "resolver" ? <Wallet pubkey={c.disputeResolverPubkey} /> : null}
                  </span>
                ) : (
                  <span className="text-white/25">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
