import "server-only";
import { cache } from "react";
import { AppError } from "./errors";
import { readSession } from "./session";
import { isRevoked, rolesFor, type Role } from "@/services/auth";

export interface CurrentUser {
  pubkey: string;
  roles: Set<Role>;
}

/** Session + roles, memoised per request. Roles always come from the database. */
export const currentUser = cache(async (campaignId: string | null = null): Promise<CurrentUser | null> => {
  const s = await readSession();
  if (!s) return null;
  if (await isRevoked(s.pk, new Date(s.iat * 1000))) return null;
  return { pubkey: s.pk, roles: await rolesFor(s.pk, campaignId) };
});

export async function requireUser(campaignId: string | null = null): Promise<CurrentUser> {
  const u = await currentUser(campaignId);
  if (!u) throw AppError.unauthenticated();
  return u;
}

export async function requireUserRole(role: Role, campaignId: string | null = null): Promise<CurrentUser> {
  const u = await requireUser(campaignId);
  if (!u.roles.has(role)) throw AppError.forbidden(`requires ${role} role`);
  return u;
}
