import { notFound } from "next/navigation";
import { AdminAccess } from "@/components/admin-access";
import { SignedOut } from "@/components/signed-out";
import { db } from "@/db/client";
import { currentUser } from "@/lib/current-user";
import { isAppError } from "@/lib/errors";
import { formatDate, formatTimestamp } from "@/lib/format";
import { accessOverview, LOG_LIMIT, PENDING_LIMIT } from "@/services/access";

export const dynamic = "force-dynamic";

/** Operator page: funder access requests, current funders and the access log. */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) return <SignedOut />;
  // The service decides who may read this. Any other wallet gets the same page as a wrong URL.
  const view = await accessOverview(user, db).catch((e: unknown) => {
    if (isAppError(e) && e.code === "FORBIDDEN") return null;
    throw e;
  });
  if (!view) notFound();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Funder access</h1>
        <p className="mt-1 text-sm text-text-2">
          Approve or reject requests and revoke access. Every grant and revocation is written to the log below; a rejection
          changes no role and stays on the request.
        </p>
      </div>
      <AdminAccess
        pending={view.pending.map((r) => ({ id: r.id, pubkey: r.pubkey, team: r.team, note: r.note, requestedAt: formatDate(r.createdAt) }))}
        funders={view.funders.map((f) => ({ pubkey: f.pubkey, team: f.team, grantedAt: formatDate(f.grantedAt) }))}
        log={view.log.map((e) => ({ id: e.id, pubkey: e.pubkey, role: e.role, action: e.action, actor: e.actorPubkey, via: e.via, campaignId: e.campaignId, at: formatTimestamp(e.at) }))}
        pendingCut={view.pendingCut ? PENDING_LIMIT : null}
        logCut={view.logCut ? LOG_LIMIT : null}
      />
    </div>
  );
}
