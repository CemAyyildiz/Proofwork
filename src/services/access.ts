import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accessLog, campaigns, funderRequests, roleGrants, type AccessLogEntry, type FunderRequest } from "@/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { newId } from "@/lib/ids";
import type { Role } from "./auth";

/**
 * Funder access: a wallet asks, the operator (the `ops` role) decides, and
 * every change of a role is written to `access_log`.
 *
 * `changeRole` is the only code that inserts into or deletes from
 * `role_grant`. `scripts/grant-role.ts` runs it too, so this module does not
 * import "server-only" and every function takes its connection.
 */

/** Who is changing the role: an ops wallet on the admin page, or the operator's script. */
export type RoleChangeActor = { via: "admin"; pubkey: string } | { via: "script" };

export interface RoleChange {
  pubkey: string;
  role: Role;
  action: "grant" | "revoke";
  /** Scope of the grant. Omitted or null = global. */
  campaignId?: string | null;
  /** The approved request behind a grant, when there is one. */
  requestId?: string;
}

async function holdsGlobalRole(pubkey: string, role: Role, conn: Db): Promise<boolean> {
  const rows = await conn
    .select({ pubkey: roleGrants.pubkey })
    .from(roleGrants)
    .where(and(eq(roleGrants.pubkey, pubkey), eq(roleGrants.role, role), isNull(roleGrants.campaignId)))
    .limit(1);
  return rows.length > 0;
}

async function requireOps(pubkey: string, conn: Db): Promise<void> {
  if (!(await holdsGlobalRole(pubkey, "ops", conn))) throw AppError.forbidden("requires ops role");
}

/**
 * Grants or revokes one role and writes its access-log entry in the same
 * transaction: if either write fails, neither is kept. Returns whether
 * anything changed. Granting a role already held, or revoking one not held,
 * changes nothing and writes no entry. An `admin` actor must hold `ops`.
 */
export async function changeRole(change: RoleChange, actor: RoleChangeActor, conn: Db): Promise<boolean> {
  const { pubkey, role, action } = change;
  const campaignId = change.campaignId ?? null;
  return conn.transaction(async (tx) => {
    if (actor.via === "admin") await requireOps(actor.pubkey, tx);
    const changed =
      action === "grant"
        ? await tx.insert(roleGrants).values({ pubkey, role, campaignId }).onConflictDoNothing().returning({ pubkey: roleGrants.pubkey })
        : await tx
            .delete(roleGrants)
            .where(
              and(
                eq(roleGrants.pubkey, pubkey),
                eq(roleGrants.role, role),
                campaignId === null ? isNull(roleGrants.campaignId) : eq(roleGrants.campaignId, campaignId),
              ),
            )
            .returning({ pubkey: roleGrants.pubkey });
    if (changed.length === 0) return false;
    await tx.insert(accessLog).values({
      id: newId("acl"),
      pubkey,
      role,
      action,
      actorPubkey: actor.via === "admin" ? actor.pubkey : null,
      via: actor.via,
      campaignId,
      requestId: change.requestId ?? null,
    });
    return true;
  });
}

/** The request form: a team name and a short note. No contact field of any kind. */
export const funderRequestSchema = z.object({
  team: z.string().trim().min(2).max(80),
  note: z.string().trim().min(1).max(500),
});

export type FunderRequestInput = z.infer<typeof funderRequestSchema>;

/**
 * Stores a pending request for the caller's wallet. Refused when the wallet
 * already has funder access or already has a pending request; the partial
 * unique index refuses the second of two concurrent posts.
 */
export async function requestFunderAccess(input: FunderRequestInput, actor: { pubkey: string }, conn: Db): Promise<FunderRequest> {
  if (await holdsGlobalRole(actor.pubkey, "funder", conn)) throw AppError.conflict("this wallet already has funder access");
  try {
    const [row] = await conn
      .insert(funderRequests)
      .values({ id: newId("frq"), pubkey: actor.pubkey, team: input.team, note: input.note })
      .returning();
    if (!row) throw new AppError("INTERNAL", "request was not stored");
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("a request from this wallet is already pending");
    throw e;
  }
}

/** The wallet's most recent request, whatever its status. */
export async function latestFunderRequest(pubkey: string, conn: Db): Promise<FunderRequest | null> {
  const rows = await conn
    .select()
    .from(funderRequests)
    .where(eq(funderRequests.pubkey, pubkey))
    .orderBy(desc(funderRequests.createdAt), desc(funderRequests.id))
    .limit(1);
  return rows[0] ?? null;
}

export type FunderAccessState = "none" | "pending" | "rejected" | "removed";

/**
 * What a wallet without the funder role is shown on the campaigns page.
 * `removed` comes from the access log, not from the requests: the wallet's
 * last global funder entry is a revocation, however the role was granted. A
 * request rejected after that revocation is shown as rejected.
 */
export async function funderAccessState(pubkey: string, conn: Db): Promise<{ state: FunderAccessState; request: FunderRequest | null }> {
  const request = await latestFunderRequest(pubkey, conn);
  if (request?.status === "pending") return { state: "pending", request };
  const last = (
    await conn
      .select({ action: accessLog.action, at: accessLog.at })
      .from(accessLog)
      .where(and(eq(accessLog.pubkey, pubkey), eq(accessLog.role, "funder"), isNull(accessLog.campaignId)))
      .orderBy(desc(accessLog.at), desc(accessLog.id))
      .limit(1)
  )[0];
  const revokedAt = last?.action === "revoke" ? last.at : null;
  if (request?.status === "rejected" && (revokedAt === null || (request.decidedAt ?? request.createdAt) > revokedAt)) {
    return { state: "rejected", request };
  }
  return { state: revokedAt ? "removed" : "none", request };
}

/**
 * Operator decision on a pending request. Approval grants the funder role
 * through `changeRole` in the same transaction as the status change, so a
 * request is never approved without its grant. A rejection changes no role
 * and writes no log entry. A request that is no longer pending is refused.
 */
export async function decideRequest(
  input: { requestId: string; decision: "approve" | "reject" },
  actor: { pubkey: string },
  conn: Db,
): Promise<FunderRequest> {
  return conn.transaction(async (tx) => {
    await requireOps(actor.pubkey, tx);
    const [row] = await tx
      .update(funderRequests)
      .set({ status: input.decision === "approve" ? "approved" : "rejected", decidedAt: new Date(), decidedBy: actor.pubkey })
      .where(and(eq(funderRequests.id, input.requestId), eq(funderRequests.status, "pending")))
      .returning();
    if (!row) {
      const known = await tx.select({ id: funderRequests.id }).from(funderRequests).where(eq(funderRequests.id, input.requestId)).limit(1);
      if (known.length === 0) throw AppError.notFound("request");
      throw AppError.conflict("this request has already been decided");
    }
    if (input.decision === "approve") {
      await changeRole({ pubkey: row.pubkey, role: "funder", action: "grant", requestId: row.id }, { via: "admin", pubkey: actor.pubkey }, tx);
    }
    return row;
  });
}

/** Removes a wallet's funder access. `changed` is false when it had none. */
export async function revokeFunder(pubkey: string, actor: { pubkey: string }, conn: Db): Promise<{ changed: boolean }> {
  return { changed: await changeRole({ pubkey, role: "funder", action: "revoke" }, { via: "admin", pubkey: actor.pubkey }, conn) };
}

export interface FunderRow {
  pubkey: string;
  grantedAt: Date;
  /** Team name from the wallet's latest approved request; null for a grant made with the script. */
  team: string | null;
}

/** The admin page reads at most this many pending requests, oldest first. */
export const PENDING_LIMIT = 100;
/** The admin page reads at most this many log entries, newest first. */
export const LOG_LIMIT = 200;

export interface AccessOverview {
  /** Pending requests, oldest first, at most PENDING_LIMIT. */
  pending: FunderRequest[];
  /** True when more pending requests exist than `pending` holds. */
  pendingCut: boolean;
  /** Wallets holding the funder role, newest grant first. */
  funders: FunderRow[];
  /** Access-log entries, newest first, at most LOG_LIMIT. */
  log: AccessLogEntry[];
  /** True when older entries exist than `log` holds. */
  logCut: boolean;
}

/** Everything the admin page shows. Ops only. */
export async function accessOverview(actor: { pubkey: string }, conn: Db): Promise<AccessOverview> {
  await requireOps(actor.pubkey, conn);
  // One row past each limit tells whether the list was cut.
  const pending = await conn
    .select()
    .from(funderRequests)
    .where(eq(funderRequests.status, "pending"))
    .orderBy(asc(funderRequests.createdAt), asc(funderRequests.id))
    .limit(PENDING_LIMIT + 1);
  const grants = await conn
    .select({ pubkey: roleGrants.pubkey, grantedAt: roleGrants.grantedAt })
    .from(roleGrants)
    .where(and(eq(roleGrants.role, "funder"), isNull(roleGrants.campaignId)))
    .orderBy(desc(roleGrants.grantedAt), asc(roleGrants.pubkey));
  const teams = new Map<string, string>();
  if (grants.length > 0) {
    const approved = await conn
      .select({ pubkey: funderRequests.pubkey, team: funderRequests.team })
      .from(funderRequests)
      .where(and(eq(funderRequests.status, "approved"), inArray(funderRequests.pubkey, grants.map((g) => g.pubkey))))
      .orderBy(asc(funderRequests.createdAt), asc(funderRequests.id));
    // Oldest first, so the latest approved request wins.
    for (const r of approved) teams.set(r.pubkey, r.team);
  }
  const log = await conn.select().from(accessLog).orderBy(desc(accessLog.at), desc(accessLog.id)).limit(LOG_LIMIT + 1);
  return {
    pending: pending.slice(0, PENDING_LIMIT),
    pendingCut: pending.length > PENDING_LIMIT,
    funders: grants.map((g) => ({ ...g, team: teams.get(g.pubkey) ?? null })),
    log: log.slice(0, LOG_LIMIT),
    logCut: log.length > LOG_LIMIT,
  };
}

/**
 * Whether a wallet may open and act on a campaign as its funder: it must own
 * the campaign and either hold the funder role or have funded the campaign.
 * Funding is enough on its own so that revoking funder access never strands
 * money in an escrow: the owner keeps approval, release and close.
 */
export function canManageCampaign(
  campaign: { funderPubkey: string; fundedAt: Date | null },
  actor: { pubkey: string; roles: ReadonlySet<Role> },
): boolean {
  return campaign.funderPubkey === actor.pubkey && (actor.roles.has("funder") || campaign.fundedAt !== null);
}

/**
 * The /campaigns nav item for a signed-in wallet. `manage`: it has campaigns
 * to run there, as a funder or as the owner of a funded campaign that it must
 * still be able to pay out and close. `request`: the page offers it the
 * funder access form.
 */
export async function campaignsNav(actor: { pubkey: string; roles: ReadonlySet<Role> }, conn: Db): Promise<"manage" | "request"> {
  if (actor.roles.has("funder")) return "manage";
  const funded = await conn
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.funderPubkey, actor.pubkey), isNotNull(campaigns.fundedAt)))
    .limit(1);
  return funded.length > 0 ? "manage" : "request";
}
