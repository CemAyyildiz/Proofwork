import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminAccess } from "@/components/admin-access";
import { SignedOut } from "@/components/signed-out";
import { Card } from "@/components/ui/card";
import { HashChip } from "@/components/ui/hash-chip";
import { OWNER_LABEL, StagePill } from "@/components/workspace/campaign-phase";
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
          {overview.length === 0 ? <p className="text-sm text-muted">No campaigns yet.</p> : <CampaignsTable rows={overview} />}
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
    <section className="space-y-4" aria-labelledby={headingId}>
      <div className="max-w-[720px]">
        <h2 id={headingId} className="text-[20px] font-semibold tracking-[-0.02em]">
          {title}
          {count !== undefined ? <span className="ml-2 font-mono text-[12px] font-medium text-muted">{count}</span> : null}
        </h2>
        <p className="mt-1.5 text-sm leading-normal text-text-2">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Wallet({ pubkey }: { pubkey: string }) {
  return <HashChip value={pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(pubkey)} />;
}

/** One closed campaign whose remainder waits on this wallet. */
function AwaitingRow({ campaign: c }: { campaign: Campaign }) {
  return (
    <Card className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
      <div className="min-w-0 space-y-2.5">
        <StagePill stage="closed_awaiting_return" />
        <h3 className="text-lg font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere]">{c.title}</h3>
        <p className="font-mono text-[12px] text-muted">Closed {c.closedAt ? formatDateShort(c.closedAt) : "—"}</p>
        <dl className="space-y-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-muted">Funder</dt>
            <dd>
              <Wallet pubkey={c.funderPubkey} />
            </dd>
          </div>
          {c.escrowContractId ? (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-muted">Escrow</dt>
              <dd>
                <HashChip value={c.escrowContractId} href={publicEnv.explorerContractUrl(c.escrowContractId)} />
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="min-w-0">
        <RemainderReturn campaignId={c.id} resolver={c.disputeResolverPubkey} />
      </div>
    </Card>
  );
}

const th = "whitespace-nowrap py-2 pr-4 text-left font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted";
const td = "whitespace-nowrap py-3 pr-4 align-top";

/** Every campaign. A narrow screen scrolls the table sideways rather than wrapping wallets and pills. */
function CampaignsTable({ rows }: { rows: CampaignOverviewRow[] }) {
  return (
    <div className="overflow-x-auto">
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
              <td className="min-w-[12rem] py-3 pr-4 align-top">
                <p className="font-medium [overflow-wrap:anywhere]">{c.title}</p>
                <p className="mt-0.5 font-mono text-[11.5px] text-muted">{c.slug}</p>
              </td>
              <td className={td}>
                <Wallet pubkey={c.funderPubkey} />
              </td>
              <td className={td}>
                <StagePill stage={stage} />
              </td>
              <td className={`${td} font-mono text-[12px] text-text-2`}>{formatDateShort(c.deadlineAt)}</td>
              <td className={td}>
                {step.owner ? (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{OWNER_LABEL[step.owner]}</span>
                    {step.owner === "resolver" ? <Wallet pubkey={c.disputeResolverPubkey} /> : null}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
