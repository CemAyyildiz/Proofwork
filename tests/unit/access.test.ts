import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { eq, sql } from "drizzle-orm";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { accessLog, campaigns, decisions, escrowOps, funderRequests, payouts, roleGrants, submissions } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import {
  accessOverview,
  canManageCampaign,
  changeRole,
  decideRequest,
  funderAccessState,
  latestFunderRequest,
  LOG_LIMIT,
  PENDING_LIMIT,
  requestFunderAccess,
  revokeFunder,
} from "@/services/access";
import { makeTestDb } from "./db";
import { horizonAccount, horizonAccountsOnly } from "./funder-wallet";

const world = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  conn: undefined as unknown,
  escrow: null as unknown,
  platform: { admin: "", ops: "", ledger: "" },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/admin",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/wallet/kit", () => ({ login: async () => undefined, logout: async () => undefined, signTransaction: async () => "" }));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("@/escrow", () => ({ getEscrow: () => world.escrow, getPlatformKeys: () => world.platform }));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", "s".repeat(43));
});

const { POST: requestRoute } = await import("@/app/api/access/requests/route");
const { POST: adminRoute } = await import("@/app/api/admin/access/route");
const { POST: campaignsRoute } = await import("@/app/api/campaigns/route");
const { POST: escrowRoute } = await import("@/app/api/campaigns/[id]/escrow/route");
const { POST: payoutsRoute } = await import("@/app/api/campaigns/[id]/payouts/route");
const { GET: reviewLogRoute } = await import("@/app/api/campaigns/[id]/review-log/route");
const { default: AdminPage } = await import("@/app/(workspace)/admin/page");
const { default: CampaignsPage } = await import("@/app/(workspace)/campaigns/page");
const { default: CampaignPage } = await import("@/app/(workspace)/campaigns/[slug]/page");
const { default: WorkspaceLayout } = await import("@/app/(workspace)/layout");
const { encodeSession } = await import("@/lib/session");
const { rolesFor } = await import("@/services/auth");
const { STALE_SUBMITTED_MS } = await import("@/services/escrow-ops");
const { confirmClose, confirmReleaseOp } = await import("@/services/payout");

const ORIGIN = "https://proofwork.test";
const REQUEST = { team: "Lumen Labs", note: "A two-week campaign for our testnet launch, about 20 contributors." };

let conn: Db;
let close: () => Promise<void>;
let escrow: FakeEscrow;
/** Fresh keys per test, so the in-memory rate limiter starts empty for each. */
let OPS: string;
let TEAM: string;
let OTHER: string;
let ip = 0;
let clientIp: string;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
  escrow = new FakeEscrow();
  world.escrow = escrow;
  world.platform = { admin: Keypair.random().publicKey(), ops: Keypair.random().publicKey(), ledger: Keypair.random().publicKey() };
  OPS = Keypair.random().publicKey();
  TEAM = Keypair.random().publicKey();
  OTHER = Keypair.random().publicKey();
  clientIp = `203.0.113.${++ip}`;
  // Deploy and fund read the funder's wallet on Horizon first; here every wallet can fund what these tests create.
  // Nothing else here may reach the network: any other request fails the test that made it.
  vi.stubGlobal("fetch", horizonAccountsOnly(() => ({ status: 200, body: horizonAccount("1000.0000000") })));
  // The one-time bootstrap: the operator's wallet gets `ops` from the script.
  await changeRole({ pubkey: OPS, role: "ops", action: "grant" }, { via: "script" }, conn);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await close();
});

const ops = () => ({ pubkey: OPS });
const team = () => ({ pubkey: TEAM });

async function logRows() {
  // Without the bootstrap entry written in beforeEach.
  return (await conn.select().from(accessLog)).filter((e) => !(e.pubkey === OPS && e.role === "ops"));
}

async function grantsOf(pubkey: string) {
  return (await conn.select().from(roleGrants).where(eq(roleGrants.pubkey, pubkey))).map((g) => g.role).sort();
}

/** From here on every insert into the access log is refused by the database, as a failed write would be. */
async function breakLog(): Promise<void> {
  await conn.execute(sql.raw(`CREATE FUNCTION refuse_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'log write refused'; END $$`));
  await conn.execute(sql.raw(`CREATE TRIGGER refuse_log BEFORE INSERT ON "access_log" FOR EACH ROW EXECUTE FUNCTION refuse_log()`));
}

/** TEAM requested and was approved by OPS. */
async function approved(): Promise<string> {
  const r = await requestFunderAccess(REQUEST, team(), conn);
  await decideRequest({ requestId: r.id, decision: "approve" }, ops(), conn);
  return r.id;
}

describe("requestFunderAccess", () => {
  it("stores a pending request the wallet and the operator can both see", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    expect(r).toMatchObject({ pubkey: TEAM, team: REQUEST.team, note: REQUEST.note, status: "pending", decidedAt: null, decidedBy: null });
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ id: r.id, status: "pending" });
    expect((await accessOverview(ops(), conn)).pending.map((p) => p.id)).toEqual([r.id]);
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it("refuses a second request while one is pending", async () => {
    await requestFunderAccess(REQUEST, team(), conn);
    await expect(requestFunderAccess(REQUEST, team(), conn)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await conn.select().from(funderRequests)).toHaveLength(1);
  });

  it("stores one request when the same wallet posts twice at once", async () => {
    const results = await Promise.allSettled([requestFunderAccess(REQUEST, team(), conn), requestFunderAccess(REQUEST, team(), conn)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await conn.select().from(funderRequests)).toHaveLength(1);
  });

  it("refuses a wallet that already has funder access", async () => {
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await expect(requestFunderAccess(REQUEST, team(), conn)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await conn.select().from(funderRequests)).toHaveLength(0);
  });

  it("has the one-pending rule in the database itself", async () => {
    await conn.insert(funderRequests).values({ id: "frq_a", pubkey: TEAM, team: "A", note: "n" });
    await expect(conn.insert(funderRequests).values({ id: "frq_b", pubkey: TEAM, team: "B", note: "n" })).rejects.toThrow();
    await expect(conn.insert(funderRequests).values({ id: "frq_c", pubkey: OTHER, team: "C", note: "n" })).resolves.toBeDefined();
  });
});

describe("decideRequest", () => {
  it("approve: marks the request, grants funder and writes one grant entry naming the ops wallet", async () => {
    const id = await approved();
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ id, status: "approved", decidedBy: OPS, decidedAt: expect.any(Date) });
    expect(await grantsOf(TEAM)).toEqual(["funder"]);
    const log = await logRows();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ pubkey: TEAM, role: "funder", action: "grant", actorPubkey: OPS, via: "admin", campaignId: null, requestId: id, at: expect.any(Date) });
    expect((await accessOverview(ops(), conn)).funders).toEqual([{ pubkey: TEAM, team: REQUEST.team, grantedAt: expect.any(Date) }]);
  });

  it("reject: marks the request, grants nothing, writes no entry, and the wallet may ask again", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await decideRequest({ requestId: r.id, decision: "reject" }, ops(), conn);
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ id: r.id, status: "rejected", decidedBy: OPS });
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);

    const again = await requestFunderAccess({ ...REQUEST, note: "Second try, with more detail." }, team(), conn);
    expect(again.status).toBe("pending");
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ id: again.id });
  });

  it.each(["approve", "reject"] as const)("refuses to %s a request that is already approved; nothing changes", async (decision) => {
    const id = await approved();
    await expect(decideRequest({ requestId: id, decision }, ops(), conn)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ status: "approved" });
    expect(await grantsOf(TEAM)).toEqual(["funder"]);
    expect(await logRows()).toHaveLength(1);
  });

  it("refuses to approve a rejected request", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await decideRequest({ requestId: r.id, decision: "reject" }, ops(), conn);
    await expect(decideRequest({ requestId: r.id, decision: "approve" }, ops(), conn)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it("two approvals at once: one wins, one grant, one entry", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    const decide = () => decideRequest({ requestId: r.id, decision: "approve" }, ops(), conn);
    const results = await Promise.allSettled([decide(), decide()]);
    expect(results.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await grantsOf(TEAM)).toEqual(["funder"]);
    expect(await logRows()).toHaveLength(1);
  });

  it("an unknown request is NOT_FOUND", async () => {
    await expect(decideRequest({ requestId: "frq_missing", decision: "approve" }, ops(), conn)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("approving a wallet the script already made a funder approves the request and writes no second entry", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await decideRequest({ requestId: r.id, decision: "approve" }, ops(), conn);
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ status: "approved" });
    expect((await logRows()).map((e) => e.via)).toEqual(["script"]);
  });
});

describe("revokeFunder", () => {
  it("removes the role and writes one revoke entry; the wallet may ask again", async () => {
    await approved();
    expect(await revokeFunder(TEAM, ops(), conn)).toEqual({ changed: true });
    expect(await grantsOf(TEAM)).toEqual([]);
    const log = await logRows();
    expect(log.map((e) => e.action).sort()).toEqual(["grant", "revoke"]);
    expect(log.find((e) => e.action === "revoke")).toMatchObject({ pubkey: TEAM, role: "funder", actorPubkey: OPS, via: "admin", requestId: null });
    expect((await accessOverview(ops(), conn)).funders).toEqual([]);

    await expect(requestFunderAccess(REQUEST, team(), conn)).resolves.toMatchObject({ status: "pending" });
  });

  it("revoking a wallet without funder access changes nothing and writes no entry", async () => {
    expect(await revokeFunder(TEAM, ops(), conn)).toEqual({ changed: false });
    expect(await logRows()).toEqual([]);
  });
});

describe("ops only", () => {
  it("refuses every read and mutation from a wallet without ops, and changes nothing", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    const before = await conn.select().from(accessLog);
    // A funder, a reviewer and the requester itself are all not the operator.
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    for (const pubkey of [OTHER, TEAM]) {
      await expect(accessOverview({ pubkey }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decideRequest({ requestId: r.id, decision: "approve" }, { pubkey }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decideRequest({ requestId: r.id, decision: "reject" }, { pubkey }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(revokeFunder(OTHER, { pubkey }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(changeRole({ pubkey, role: "ops", action: "grant" }, { via: "admin", pubkey }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ status: "pending", decidedBy: null });
    expect(await grantsOf(OTHER)).toEqual(["funder"]);
    expect(await grantsOf(TEAM)).toEqual(["reviewer"]);
    expect(await conn.select().from(accessLog)).toHaveLength(before.length + 1);
  });

  it("an ops grant scoped to one campaign is not the operator", async () => {
    await conn.insert(campaigns).values({
      id: "cmp_1",
      slug: "camp-1",
      title: "Campaign",
      brief: "A brief long enough to pass validation.",
      rewardAmount: "10",
      budget: "100",
      deadlineAt: new Date(Date.now() + 86_400_000),
      funderPubkey: OTHER,
      disputeResolverPubkey: "G_DR",
    });
    await changeRole({ pubkey: OTHER, role: "ops", action: "grant", campaignId: "cmp_1" }, { via: "script" }, conn);
    await expect(accessOverview({ pubkey: OTHER }, conn)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("changeRole", () => {
  it("script grant and revoke touch only the named role and are logged as coming from the script", async () => {
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    expect(await grantsOf(TEAM)).toEqual(["funder", "reviewer"]);

    expect(await changeRole({ pubkey: TEAM, role: "reviewer", action: "revoke" }, { via: "script" }, conn)).toBe(true);
    expect(await grantsOf(TEAM)).toEqual(["funder"]);
    const log = await logRows();
    expect(log).toHaveLength(3);
    for (const e of log) expect(e).toMatchObject({ pubkey: TEAM, via: "script", actorPubkey: null, requestId: null });
    expect(log.map((e) => `${e.action} ${e.role}`).sort()).toEqual(["grant funder", "grant reviewer", "revoke reviewer"]);
  });

  it("granting a role already held, or revoking one not held, changes nothing and writes no entry", async () => {
    expect(await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn)).toBe(true);
    expect(await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn)).toBe(false);
    expect(await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "admin", pubkey: OPS }, conn)).toBe(false);
    expect(await changeRole({ pubkey: TEAM, role: "reviewer", action: "revoke" }, { via: "script" }, conn)).toBe(false);
    expect(await changeRole({ pubkey: OTHER, role: "funder", action: "revoke" }, { via: "admin", pubkey: OPS }, conn)).toBe(false);
    expect(await grantsOf(TEAM)).toEqual(["funder"]);
    expect(await logRows()).toHaveLength(1);
  });

  it("two grants at once write one entry", async () => {
    const grant = () => changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    expect((await Promise.all([grant(), grant()])).sort()).toEqual([false, true]);
    expect(await logRows()).toHaveLength(1);
  });

  it("a grant whose log entry cannot be written is not kept", async () => {
    await breakLog();
    await expect(changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn)).rejects.toThrow();
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it("a revocation whose log entry cannot be written is not kept", async () => {
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await breakLog();
    await expect(changeRole({ pubkey: TEAM, role: "funder", action: "revoke" }, { via: "script" }, conn)).rejects.toThrow();
    await expect(revokeFunder(TEAM, ops(), conn)).rejects.toThrow();
    expect(await grantsOf(TEAM)).toEqual(["funder"]);
    expect(await logRows()).toHaveLength(1);
  });

  it("an approval whose grant cannot be logged leaves the request pending and grants nothing", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await breakLog();
    await expect(decideRequest({ requestId: r.id, decision: "approve" }, ops(), conn)).rejects.toThrow();
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ status: "pending", decidedAt: null, decidedBy: null });
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it("a grant that fails writes no entry", async () => {
    // The grant names a campaign that does not exist, so its own insert is refused.
    await expect(changeRole({ pubkey: TEAM, role: "funder", action: "grant", campaignId: "cmp_missing" }, { via: "script" }, conn)).rejects.toThrow();
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);
  });
});

describe("accessOverview bounds", () => {
  it("reads the oldest pending requests up to the limit and says when more are waiting", async () => {
    const base = Date.UTC(2026, 9, 1);
    await conn.insert(funderRequests).values(
      Array.from({ length: PENDING_LIMIT + 1 }, (_, i) => ({ id: `frq_${i}`, pubkey: `G_REQ_${i}`, team: `Team ${i}`, note: "n", createdAt: new Date(base + i * 1000) })),
    );
    const view = await accessOverview(ops(), conn);
    expect(view.pending).toHaveLength(PENDING_LIMIT);
    expect(view.pendingCut).toBe(true);
    expect(view.pending[0]?.id).toBe("frq_0");
    expect(view.pending.at(-1)?.id).toBe(`frq_${PENDING_LIMIT - 1}`);

    signIn(OPS);
    const html = await render(AdminPage());
    expect(html).toMatch(new RegExp(`Showing the (<!-- -->)?${PENDING_LIMIT}(<!-- -->)? oldest pending requests`));
    expect(html).not.toContain("newest entries");
  });

  it("reads the newest log entries up to the limit and says when older ones exist", async () => {
    const base = Date.now() + 60_000;
    await conn.insert(accessLog).values(
      Array.from({ length: LOG_LIMIT + 1 }, (_, i) => ({ id: `acl_${i}`, pubkey: `G_W_${i}`, role: "funder" as const, action: "grant" as const, via: "script" as const, at: new Date(base + i * 1000) })),
    );
    const view = await accessOverview(ops(), conn);
    expect(view.log).toHaveLength(LOG_LIMIT);
    expect(view.logCut).toBe(true);
    expect(view.log[0]?.id).toBe(`acl_${LOG_LIMIT}`);
    // Cut at the old end: the first inserted row and the bootstrap grant before it.
    expect(view.log.at(-1)?.id).toBe("acl_1");

    signIn(OPS);
    const html = await render(AdminPage());
    expect(html).toMatch(new RegExp(`Showing the (<!-- -->)?${LOG_LIMIT}(<!-- -->)? newest entries`));
    expect(html).not.toContain("oldest pending requests");
  });

  it("says nothing was cut when both lists fit", async () => {
    await requestFunderAccess(REQUEST, team(), conn);
    expect(await accessOverview(ops(), conn)).toMatchObject({ pendingCut: false, logCut: false });
  });
});

describe("funderAccessState", () => {
  const stateOf = async (pubkey: string) => (await funderAccessState(pubkey, conn)).state;

  it("is none for a wallet that never asked and never held the role", async () => {
    expect(await stateOf(TEAM)).toBe("none");
  });

  it("is removed for a funder granted with the script and then revoked, with no request at all", async () => {
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await revokeFunder(TEAM, ops(), conn);
    expect(await funderAccessState(TEAM, conn)).toEqual({ state: "removed", request: null });
  });

  it("is removed after an approval is revoked, pending once the wallet asks again, rejected once that is refused", async () => {
    await approved();
    await revokeFunder(TEAM, ops(), conn);
    expect(await stateOf(TEAM)).toBe("removed");
    const again = await requestFunderAccess(REQUEST, team(), conn);
    expect(await stateOf(TEAM)).toBe("pending");
    await decideRequest({ requestId: again.id, decision: "reject" }, ops(), conn);
    expect(await stateOf(TEAM)).toBe("rejected");
  });

  it("is removed when the revocation is newer than an old rejection", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await decideRequest({ requestId: r.id, decision: "reject" }, ops(), conn);
    await conn.update(funderRequests).set({ decidedAt: new Date(Date.now() - 60_000) }).where(eq(funderRequests.id, r.id));
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await changeRole({ pubkey: TEAM, role: "funder", action: "revoke" }, { via: "script" }, conn);
    expect(await stateOf(TEAM)).toBe("removed");
  });

  it("ignores other roles and campaign-scoped entries", async () => {
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "revoke" }, { via: "script" }, conn);
    expect(await stateOf(TEAM)).toBe("none");
  });
});

describe("canManageCampaign", () => {
  const owner = "G_OWNER";
  const funded = { funderPubkey: owner, fundedAt: new Date() };
  const draft = { funderPubkey: owner, fundedAt: null };

  it("the owner with the funder role manages a campaign at any stage", () => {
    const actor = { pubkey: owner, roles: new Set(["funder"] as const) };
    expect(canManageCampaign(draft, actor)).toBe(true);
    expect(canManageCampaign(funded, actor)).toBe(true);
  });

  it("the owner without the role keeps a funded campaign and loses an unfunded one", () => {
    const actor = { pubkey: owner, roles: new Set<"funder">() };
    expect(canManageCampaign(funded, actor)).toBe(true);
    expect(canManageCampaign(draft, actor)).toBe(false);
  });

  it("another wallet never manages it, whatever roles it holds", () => {
    const actor = { pubkey: "G_ELSE", roles: new Set(["funder", "reviewer", "ops"] as const) };
    expect(canManageCampaign(funded, actor)).toBe(false);
    expect(canManageCampaign(draft, actor)).toBe(false);
  });
});

function signIn(wallet: string): string {
  const token = encodeSession(wallet);
  world.jar.set("pw_session", token);
  return token;
}

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify(body),
  });
}

const sendRequest = (body: unknown = REQUEST) => requestRoute(post("/api/access/requests", body));
const sendAdmin = (body: unknown) => adminRoute(post("/api/admin/access", body));
const forCampaign = (id: string) => ({ params: Promise.resolve({ id }) });

function campaignBody(title = "Launch week") {
  return {
    title,
    brief: "Post about the testnet launch and tag the project account.",
    rewardAmount: "10",
    budget: "100",
    deadlineAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    disputeResolverPubkey: Keypair.random().publicKey(),
  };
}

async function pendingId(): Promise<string> {
  const id = (await latestFunderRequest(TEAM, conn))?.id;
  if (!id) throw new Error("no request stored");
  return id;
}

describe("POST /api/access/requests", () => {
  it("answers 401 without a session and stores nothing", async () => {
    expect((await sendRequest()).status).toBe(401);
    expect(await conn.select().from(funderRequests)).toHaveLength(0);
  });

  it("stores a pending request for the session wallet", async () => {
    signIn(TEAM);
    const res = await sendRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "pending" });
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ pubkey: TEAM, team: REQUEST.team, status: "pending" });
  });

  it("takes the wallet from the session, never from the body", async () => {
    signIn(TEAM);
    expect((await sendRequest({ ...REQUEST, pubkey: OTHER, status: "approved", email: "someone@example.org" })).status).toBe(200);
    const rows = await conn.select().from(funderRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pubkey: TEAM, status: "pending" });
    expect(JSON.stringify(rows)).not.toContain("example.org");
  });

  it.each([
    ["no team", { note: REQUEST.note }],
    ["a one-letter team", { team: "a", note: REQUEST.note }],
    ["a team name over 80 characters", { team: "t".repeat(81), note: REQUEST.note }],
    ["an empty note", { team: REQUEST.team, note: "   " }],
    ["a note over 500 characters", { team: REQUEST.team, note: "n".repeat(501) }],
    ["a non-string team", { team: 42, note: REQUEST.note }],
  ])("answers 400 for %s", async (_name, body) => {
    signIn(TEAM);
    const res = await sendRequest(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION" });
    expect(await conn.select().from(funderRequests)).toHaveLength(0);
  });

  it("answers 409 for a second request and for a wallet that is already a funder", async () => {
    signIn(TEAM);
    expect((await sendRequest()).status).toBe(200);
    const second = await sendRequest();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "CONFLICT" });

    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    signIn(OTHER);
    expect((await sendRequest()).status).toBe(409);
  });

  it("is rate limited: the 6th request in an hour from one wallet answers 429", async () => {
    signIn(TEAM);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await sendRequest()).status);
    expect(statuses).toEqual([200, 409, 409, 409, 409, 429]);
  });

  it("the wallet's own limit holds when it changes address", async () => {
    signIn(TEAM);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      clientIp = `198.51.100.${++ip}`;
      statuses.push((await sendRequest()).status);
    }
    expect(statuses[5]).toBe(429);
  });
});

describe("POST /api/access/requests from one address", () => {
  it("is rate limited by address alone: a fresh wallet per request stops at the 21st in an hour", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      signIn(Keypair.random().publicKey());
      statuses.push((await sendRequest()).status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array<number>(20).fill(200));
    expect(statuses[20]).toBe(429);
    expect(await conn.select().from(funderRequests)).toHaveLength(20);
  });
});

describe("POST /api/admin/access", () => {
  it("is rate limited per session wallet: the 61st call in ten minutes answers 429", async () => {
    signIn(TEAM);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await sendAdmin({ action: "revoke", pubkey: OTHER })).status);
    expect(statuses.slice(0, 60)).toEqual(Array<number>(60).fill(403));
    expect(statuses[60]).toBe(429);
    // The operator's own count is separate.
    signIn(OPS);
    expect((await sendAdmin({ action: "revoke", pubkey: OTHER })).status).toBe(200);
  });

  it("refuses a wallet without ops with a valid body: 403, nothing changes, no entry", async () => {
    signIn(TEAM);
    await sendRequest();
    const requestId = await pendingId();
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    const before = await conn.select().from(accessLog);

    for (const wallet of [TEAM, OTHER]) {
      signIn(wallet);
      for (const body of [{ action: "approve", requestId }, { action: "reject", requestId }, { action: "revoke", pubkey: OTHER }]) {
        const res = await sendAdmin(body);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
      }
    }
    expect(await latestFunderRequest(TEAM, conn)).toMatchObject({ status: "pending" });
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await grantsOf(OTHER)).toEqual(["funder"]);
    expect(await conn.select().from(accessLog)).toEqual(before);
  });

  it("answers 401 without a session", async () => {
    expect((await sendAdmin({ action: "revoke", pubkey: OTHER })).status).toBe(401);
  });

  it.each([
    ["an unknown action", { action: "grant", pubkey: "x" }],
    ["a revoke without a valid wallet key", { action: "revoke", pubkey: "GABC" }],
    ["an approve without a request id", { action: "approve" }],
    ["a request id that is not an id", { action: "approve", requestId: "a b;c" }],
  ])("answers 400 for %s", async (_name, body) => {
    signIn(OPS);
    expect((await sendAdmin(body)).status).toBe(400);
  });

  it("approve, decide twice, revoke: 200, 409, 200, with one entry per change", async () => {
    signIn(TEAM);
    await sendRequest();
    const requestId = await pendingId();
    signIn(OPS);
    const res = await sendAdmin({ action: "approve", requestId });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: requestId, status: "approved" });
    for (const action of ["approve", "reject"]) {
      const twice = await sendAdmin({ action, requestId });
      expect(twice.status).toBe(409);
      expect(await twice.json()).toMatchObject({ error: "CONFLICT" });
    }
    expect(await logRows()).toHaveLength(1);

    const revoke = await sendAdmin({ action: "revoke", pubkey: TEAM });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ changed: true });
    expect(await (await sendAdmin({ action: "revoke", pubkey: TEAM })).json()).toEqual({ changed: false });
    expect((await logRows()).map((e) => e.action).sort()).toEqual(["grant", "revoke"]);
  });

  it("reject: 200, no role, no entry", async () => {
    signIn(TEAM);
    await sendRequest();
    signIn(OPS);
    const res = await sendAdmin({ action: "reject", requestId: await pendingId() });
    expect(await res.json()).toMatchObject({ status: "rejected" });
    expect(await grantsOf(TEAM)).toEqual([]);
    expect(await logRows()).toEqual([]);
  });
});

/** TEAM, signed in with one session throughout, is approved by OPS and creates a campaign. */
async function approvedWithCampaign(): Promise<{ token: string; id: string; slug: string }> {
  const token = signIn(TEAM);
  expect((await sendRequest()).status).toBe(200);
  const refused = await campaignsRoute(post("/api/campaigns", campaignBody()));
  expect(refused.status).toBe(403);

  signIn(OPS);
  expect((await sendAdmin({ action: "approve", requestId: await pendingId() })).status).toBe(200);

  // The cookie the wallet got before it was approved, unchanged.
  world.jar.set("pw_session", token);
  const res = await campaignsRoute(post("/api/campaigns", campaignBody()));
  expect(res.status).toBe(200);
  const { id, slug } = (await res.json()) as { id: string; slug: string };
  return { token, id, slug };
}

async function escrowStep(id: string, kind: "deploy" | "fund"): Promise<void> {
  const prepared = await escrowRoute(post(`/api/campaigns/${id}/escrow`, { action: "prepare", kind }), forCampaign(id));
  expect(prepared.status).toBe(200);
  const { opId, unsignedXdr } = (await prepared.json()) as { opId: string; unsignedXdr: string };
  const submitted = await escrowRoute(post(`/api/campaigns/${id}/escrow`, { action: "submit", kind, opId, signedXdr: unsignedXdr }), forCampaign(id));
  expect(submitted.status).toBe(200);
}

async function revokeTeam(token: string): Promise<void> {
  signIn(OPS);
  expect((await sendAdmin({ action: "revoke", pubkey: TEAM })).status).toBe(200);
  world.jar.set("pw_session", token);
}

const escrowCall = (id: string, body: unknown) => escrowRoute(post(`/api/campaigns/${id}/escrow`, body), forCampaign(id));
const payoutsCall = (id: string, body: unknown) => payoutsRoute(post(`/api/campaigns/${id}/payouts`, body), forCampaign(id));

/** One rubric-passed submission on the campaign, waiting for the funder's approval. */
async function passedSubmission(campaignId: string): Promise<string> {
  const contributor = Keypair.random().publicKey();
  await conn.insert(submissions).values({ id: "sub_1", shortId: "s1", campaignId, contributorPubkey: contributor, workUrl: "https://x.com/a/status/1", status: "decided" });
  await conn.insert(decisions).values({
    id: "dec_1",
    submissionId: "sub_1",
    reviewerPubkey: OTHER,
    outcome: "PASS",
    reasonCode: "R00_PASS",
    signals: {},
    note: "",
    canonicalJson: "{}",
    decisionHash: "h",
    ledgerKey: "pw:s1",
  });
  return contributor;
}

async function prepared(id: string, kind: "release" | "close"): Promise<{ opId: string; unsignedXdr: string }> {
  const res = await payoutsCall(id, kind === "release" ? { action: "prepare", kind, submissionIds: ["sub_1"] } : { action: "prepare", kind });
  expect(res.status).toBe(200);
  const op = ((await res.json()) as { ops: Array<{ opId: string; unsignedXdr: string }> }).ops[0];
  if (!op) throw new Error(`no ${kind} prepared`);
  return op;
}

async function campaignRow(id: string) {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, id)))[0];
  if (!c) throw new Error("campaign missing");
  return c;
}

async function opRow(opId: string) {
  const op = (await conn.select().from(escrowOps).where(eq(escrowOps.id, opId)))[0];
  if (!op) throw new Error("op missing");
  return op;
}

async function render(page: Promise<unknown>): Promise<string> {
  return renderToStaticMarkup((await page) as ReactElement);
}

describe("an approved wallet", () => {
  it("creates a campaign with the session it had before approval", async () => {
    const { id } = await approvedWithCampaign();
    const rows = await conn.select().from(campaigns).where(eq(campaigns.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ funderPubkey: TEAM, title: "Launch week" });
    expect([...(await rolesFor(TEAM, null, conn))]).toEqual(["funder"]);
  });
});

describe("a revoked funder", () => {
  it("cannot create a campaign, or deploy or fund an escrow", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await revokeTeam(token);

    const create = await campaignsRoute(post("/api/campaigns", campaignBody("Second")));
    expect(create.status).toBe(403);
    expect(await create.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(await conn.select().from(campaigns)).toHaveLength(1);

    for (const kind of ["deploy", "fund"]) {
      const res = await escrowRoute(post(`/api/campaigns/${id}/escrow`, { action: "prepare", kind }), forCampaign(id));
      expect(res.status).toBe(403);
    }
    const c = (await conn.select().from(campaigns).where(eq(campaigns.id, id)))[0];
    expect(c?.fundedAt).toBeNull();
  });

  it("gets a not-found page for a campaign it never funded", async () => {
    const { token, slug } = await approvedWithCampaign();
    await revokeTeam(token);
    await expect(CampaignPage({ params: Promise.resolve({ slug }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("still opens its funded campaign, approves, releases, closes and reads the review log", async () => {
    const { token, id, slug } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    const contributor = await passedSubmission(id);
    await revokeTeam(token);
    expect(await grantsOf(TEAM)).toEqual([]);

    const html = await render(CampaignPage({ params: Promise.resolve({ slug }) }));
    expect(html).toContain("Submissions and payouts");
    const list = await render(CampaignsPage());
    expect(list).toContain(`href="/campaigns/${slug}"`);
    expect(list).toContain("Campaigns you funded");
    expect(list).not.toContain("New campaign");

    const approve = await payoutsCall(id, { action: "approve", submissionIds: ["sub_1"] });
    expect(approve.status).toBe(200);
    expect((await conn.select().from(payouts))[0]).toMatchObject({ submissionId: "sub_1", status: "approved" });

    for (const kind of ["release", "close"] as const) {
      const op = await prepared(id, kind);
      const submitted = await payoutsCall(id, { action: "submit", kind, opId: op.opId, signedXdr: op.unsignedXdr });
      expect(submitted.status).toBe(200);
    }
    expect((await conn.select().from(payouts))[0]).toMatchObject({ status: "released" });
    const c = (await conn.select().from(campaigns).where(eq(campaigns.id, id)))[0];
    expect(c?.closedAt).toBeInstanceOf(Date);

    const logRes = await reviewLogRoute(new Request(`${ORIGIN}/api/campaigns/${id}/review-log?format=json`), forCampaign(id));
    expect(logRes.status).toBe(200);
    expect(await logRes.json()).toEqual([expect.objectContaining({ decision_id: "dec_1", contributor_pubkey: contributor })]);
  });

  it("cannot approve, release or close on a campaign it deployed but never funded", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    // A close prepared while it still had the role, to submit after losing it.
    const close = await prepared(id, "close");
    await revokeTeam(token);

    for (const body of [
      { action: "prepare", kind: "release", submissionIds: ["sub_1"] },
      { action: "prepare", kind: "close" },
      { action: "submit", kind: "close", opId: close.opId, signedXdr: close.unsignedXdr },
      { action: "approve", submissionIds: ["sub_1"] },
    ]) {
      const res = await payoutsCall(id, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    }
    expect((await campaignRow(id)).closedAt).toBeNull();
    expect((await opRow(close.opId)).status).toBe("intent");
    expect(escrow.submits).toBe(1);
  });

  it("can reconcile a fund it submitted before the revocation, and the campaign becomes funded", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    const res = await escrowCall(id, { action: "prepare", kind: "fund" });
    const { opId, unsignedXdr } = (await res.json()) as { opId: string; unsignedXdr: string };
    // The transaction lands, but the server never records the answer: the op stays `submitted`.
    await escrow.submit(unsignedXdr);
    await conn.update(escrowOps).set({ status: "submitted", updatedAt: new Date(Date.now() - STALE_SUBMITTED_MS - 1000) }).where(eq(escrowOps.id, opId));
    await revokeTeam(token);
    expect((await campaignRow(id)).fundedAt).toBeNull();

    // Deploy still needs the role, and another wallet gets nowhere on the fund path.
    expect((await escrowCall(id, { action: "prepare", kind: "deploy" })).status).toBe(403);
    signIn(OTHER);
    expect((await escrowCall(id, { action: "prepare", kind: "fund" })).status).toBe(403);
    world.jar.set("pw_session", token);

    const reconciled = await escrowCall(id, { action: "prepare", kind: "fund" });
    expect(reconciled.status).toBe(409);
    expect(await reconciled.json()).toMatchObject({ error: "CONFLICT", message: expect.stringContaining("fund already confirmed") });
    expect((await opRow(opId)).status).toBe("confirmed");
    expect((await campaignRow(id)).fundedAt).toBeInstanceOf(Date);
    expect(escrow.submits).toBe(2);

    // Funded now, so the campaign is the owner's to pay out and close.
    const html = await render(CampaignPage({ params: Promise.resolve({ slug: (await campaignRow(id)).slug }) }));
    expect(html).toContain("Submissions and payouts");
    expect((await payoutsCall(id, { action: "prepare", kind: "release", submissionIds: ["sub_1"] })).status).toBe(200);
  });

  it("cannot send a fund that was prepared but never submitted", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    const res = await escrowCall(id, { action: "prepare", kind: "fund" });
    const { opId, unsignedXdr } = (await res.json()) as { opId: string; unsignedXdr: string };
    await revokeTeam(token);

    expect((await escrowCall(id, { action: "prepare", kind: "fund" })).status).toBe(403);
    expect((await escrowCall(id, { action: "submit", kind: "fund", opId, signedXdr: unsignedXdr })).status).toBe(403);
    expect((await opRow(opId)).status).toBe("intent");
    expect((await campaignRow(id)).fundedAt).toBeNull();
    expect(escrow.submits).toBe(1);
  });

  it("cannot put new money in after a fund that failed without landing", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    const res = await escrowCall(id, { action: "prepare", kind: "fund" });
    const { opId } = (await res.json()) as { opId: string };
    await conn.update(escrowOps).set({ status: "failed", error: "send-transaction timed out" }).where(eq(escrowOps.id, opId));
    await revokeTeam(token);

    // The chain is asked, shows nothing, and the op is rebuilt at `intent`: from there it needs the role again.
    const rebuilt = await escrowCall(id, { action: "prepare", kind: "fund" });
    expect(rebuilt.status).toBe(200);
    const { unsignedXdr } = (await rebuilt.json()) as { unsignedXdr: string };
    expect((await opRow(opId)).status).toBe("intent");
    expect((await escrowCall(id, { action: "submit", kind: "fund", opId, signedXdr: unsignedXdr })).status).toBe(403);
    expect((await escrowCall(id, { action: "prepare", kind: "fund" })).status).toBe(403);
    expect((await campaignRow(id)).fundedAt).toBeNull();
    expect(escrow.submits).toBe(1);
    const contractId = (await campaignRow(id)).escrowContractId;
    expect(contractId).not.toBeNull();
    expect((await escrow.getEscrow(contractId ?? "")).balance).toBe("0");
  });

  it("only the owner can submit a release or a close the owner prepared", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    await passedSubmission(id);
    expect((await payoutsCall(id, { action: "approve", submissionIds: ["sub_1"] })).status).toBe(200);
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);

    const release = await prepared(id, "release");
    signIn(OTHER);
    const stolenRelease = await payoutsCall(id, { action: "submit", kind: "release", opId: release.opId, signedXdr: release.unsignedXdr });
    expect(stolenRelease.status).toBe(403);
    // The service refuses on its own too, whatever the route let through.
    await expect(
      confirmReleaseOp({ campaignId: id, opId: release.opId, signedXdr: release.unsignedXdr }, { pubkey: OTHER }, escrow, conn),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await conn.select().from(payouts))[0]).toMatchObject({ status: "approved", releaseTxHash: null });
    expect((await opRow(release.opId)).status).toBe("intent");

    world.jar.set("pw_session", token);
    expect((await payoutsCall(id, { action: "submit", kind: "release", opId: release.opId, signedXdr: release.unsignedXdr })).status).toBe(200);
    const close = await prepared(id, "close");
    signIn(OTHER);
    const stolenClose = await payoutsCall(id, { action: "submit", kind: "close", opId: close.opId, signedXdr: close.unsignedXdr });
    expect(stolenClose.status).toBe(403);
    await expect(confirmClose({ campaignId: id, opId: close.opId, signedXdr: close.unsignedXdr }, { pubkey: OTHER }, escrow, conn)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await campaignRow(id)).closedAt).toBeNull();
    expect((await opRow(close.opId)).status).toBe("intent");
  });

  it("a release prepare names its selection: none, an empty one or more than 50 is refused", async () => {
    const { id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    await passedSubmission(id);
    expect((await payoutsCall(id, { action: "approve", submissionIds: ["sub_1"] })).status).toBe(200);
    const tooMany = Array.from({ length: 51 }, (_, i) => `sub_${i}`);
    for (const body of [
      { action: "prepare", kind: "release" },
      { action: "prepare", kind: "release", submissionIds: [] },
      { action: "prepare", kind: "release", submissionIds: tooMany },
    ]) {
      expect((await payoutsCall(id, body)).status).toBe(400);
    }
    expect(await conn.select().from(escrowOps).where(eq(escrowOps.kind, "release"))).toHaveLength(0);
    // A selection that names only another submission builds nothing.
    const other = await payoutsCall(id, { action: "prepare", kind: "release", submissionIds: ["sub_other"] });
    expect(await other.json()).toEqual({ ops: [] });
  });

  it("another wallet gains nothing from the payouts route no longer asking for the role", async () => {
    const { id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    signIn(OTHER);
    for (const body of [
      { action: "approve", submissionIds: ["sub_1"] },
      { action: "prepare", kind: "release", submissionIds: ["sub_1"] },
      { action: "prepare", kind: "close" },
    ]) {
      const res = await payoutsRoute(post(`/api/campaigns/${id}/payouts`, body), forCampaign(id));
      expect(res.status).toBe(403);
    }
    world.jar.clear();
    const signedOut = await payoutsRoute(post(`/api/campaigns/${id}/payouts`, { action: "prepare", kind: "close" }), forCampaign(id));
    expect(signedOut.status).toBe(401);
  });
});

describe("campaigns page without the funder role", () => {
  it("shows the request form to a wallet that never asked", async () => {
    signIn(TEAM);
    const html = await render(CampaignsPage());
    expect(html).toContain("Request funder access");
    expect(html).toMatch(/<input[^>]*name="team"/);
    expect(html).toMatch(/<textarea[^>]*name="note"/);
    expect(html).not.toContain("New campaign");
  });

  it("asks for a team name and a note and no contact detail", async () => {
    signIn(TEAM);
    const html = await render(CampaignsPage());
    const fields = [...html.matchAll(/<(?:input|textarea|select)[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual(["team", "note"]);
    expect(html).not.toMatch(/type="(email|tel)"/);
  });

  it("shows a pending request as pending, without the form", async () => {
    signIn(TEAM);
    await sendRequest();
    const html = await render(CampaignsPage());
    expect(html).toContain("Pending");
    expect(html).toContain(REQUEST.team);
    expect(html).not.toMatch(/<input[^>]*name="team"/);
  });

  it("shows a rejected request with the form to ask again", async () => {
    const r = await requestFunderAccess(REQUEST, team(), conn);
    await decideRequest({ requestId: r.id, decision: "reject" }, ops(), conn);
    signIn(TEAM);
    const html = await render(CampaignsPage());
    expect(html).toContain("Request not approved");
    expect(html).toMatch(/<input[^>]*name="team"/);
  });

  it("tells a revoked wallet its access was removed and lets it ask again", async () => {
    await approved();
    await revokeFunder(TEAM, ops(), conn);
    signIn(TEAM);
    const html = await render(CampaignsPage());
    expect(html).toContain("Funder access removed");
    expect(html).toMatch(/<input[^>]*name="team"/);
    expect(html).not.toContain("Campaigns you funded");
  });

  it("shows the campaign list and New campaign once approved", async () => {
    await approved();
    signIn(TEAM);
    const html = await render(CampaignsPage());
    expect(html).toContain("New campaign");
    expect(html).not.toMatch(/<input[^>]*name="team"/);
  });

  it("shows a reviewer the request form and a link to the review queue instead of sending it away", async () => {
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    signIn(TEAM);
    const html = await render(CampaignsPage());
    expect(html).toContain("Request funder access");
    expect(html).toMatch(/<input[^>]*name="team"/);
    expect(html).toMatch(/<a href="\/review"[^>]*>Open the review queue/);

    await sendRequest();
    const pending = await render(CampaignsPage());
    expect(pending).toContain("Funder access requested");
    expect(pending).toMatch(/<a href="\/review"/);
  });

  it("shows no review link to a wallet that is not a reviewer", async () => {
    signIn(TEAM);
    expect(await render(CampaignsPage())).not.toContain('href="/review"');
  });

  it("shows a reviewer that lost funder access its funded campaign, the removal and the review link", async () => {
    const { token, id, slug } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await escrowStep(id, "fund");
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    await revokeTeam(token);
    const html = await render(CampaignsPage());
    expect(html).toContain("Campaigns you funded");
    expect(html).toContain(`href="/campaigns/${slug}"`);
    expect(html).toContain("Funder access removed");
    expect(html).toMatch(/<a href="\/review"[^>]*>Open the review queue/);
    expect(html).not.toContain("New campaign");
  });

  it("tells a funder granted with the script and then revoked that its access was removed", async () => {
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    await changeRole({ pubkey: TEAM, role: "funder", action: "revoke" }, { via: "script" }, conn);
    signIn(TEAM);
    const html = await render(CampaignsPage());
    expect(html).toContain("Funder access removed");
    expect(html).not.toContain("Request funder access</h2>");
    expect(html).toMatch(/<input[^>]*name="team"/);
  });
});

describe("admin page", () => {
  it("is a not-found page for a signed-in wallet without ops", async () => {
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    await changeRole({ pubkey: OTHER, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    for (const wallet of [TEAM, OTHER]) {
      signIn(wallet);
      await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("asks a visitor without a session to connect, and shows nothing else", async () => {
    await requestFunderAccess(REQUEST, team(), conn);
    const html = await render(AdminPage());
    expect(html).toContain("Connect your Stellar wallet");
    expect(html).not.toContain(REQUEST.team);
    expect(html).not.toContain("Access log");
  });

  it("lists pending requests with approve and reject, and current funders with revoke", async () => {
    await requestFunderAccess(REQUEST, team(), conn);
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    signIn(OPS);
    const html = await render(AdminPage());
    expect(html).toContain(REQUEST.team);
    expect(html).toContain(REQUEST.note);
    expect(html).toContain(`aria-label="${TEAM}"`);
    expect(html).toMatch(/<button[^>]*>.*?Approve.*?<\/button>/);
    expect(html).toMatch(/<button[^>]*>.*?Reject.*?<\/button>/);
    expect(html).toMatch(/<button[^>]*>.*?Revoke.*?<\/button>/);
    expect(html).toContain("granted with the script");
  });

  it("shows the campaign an entry was scoped to, and nothing extra for a global one", async () => {
    await conn.insert(campaigns).values({
      id: "cmp_scope",
      slug: "camp-scope",
      title: "Campaign",
      brief: "A brief long enough to pass validation.",
      rewardAmount: "10",
      budget: "100",
      deadlineAt: new Date(Date.now() + 86_400_000),
      funderPubkey: OTHER,
      disputeResolverPubkey: "G_DR",
    });
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant", campaignId: "cmp_scope" }, { via: "script" }, conn);
    signIn(OPS);
    const html = await render(AdminPage());
    expect(html).toMatch(/<td[^>]*>reviewer<span[^>]*> · campaign (<!-- -->)?cmp_scope<\/span><\/td>/);
    expect(html).toMatch(/<td[^>]*>ops<\/td>/);
    expect(html.match(/· campaign/g)).toHaveLength(1);
  });

  it("shows every log entry, newest first, with wallet, role, action, who acted and when", async () => {
    // PGlite's clock ticks in milliseconds, so entries written back to back could share a timestamp.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
    await tick();
    await changeRole({ pubkey: OTHER, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    await tick();
    await approved();
    await tick();
    await revokeFunder(TEAM, ops(), conn);
    signIn(OPS);
    const html = await render(AdminPage());

    const logTable = html.slice(html.indexOf("Access log"));
    const rows = [...logTable.matchAll(/<tr class="border-t border-line">(.*?)<\/tr>/g)].map((m) => m[1] ?? "");
    // Newest first: the revoke, the approval's grant, the script's reviewer grant, the bootstrap ops grant.
    expect(rows).toHaveLength(4);
    const cells = (row: string) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1] ?? "");
    const [revoke, grant, reviewer, bootstrap] = rows.map(cells);

    expect(revoke?.[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
    expect(revoke?.[1]).toContain(`aria-label="${TEAM}"`);
    expect(revoke?.[2]).toBe("funder");
    expect(revoke?.[3]).toContain("revoke");
    expect(revoke?.[4]).toContain(`aria-label="${OPS}"`);

    expect(grant?.[1]).toContain(`aria-label="${TEAM}"`);
    expect(grant?.[2]).toBe("funder");
    expect(grant?.[3]).toContain("grant");
    expect(grant?.[4]).toContain(`aria-label="${OPS}"`);

    expect(reviewer?.[1]).toContain(`aria-label="${OTHER}"`);
    expect(reviewer?.[2]).toBe("reviewer");
    expect(reviewer?.[3]).toContain("grant");
    expect(reviewer?.[4]).toBe("script");

    expect(bootstrap?.[1]).toContain(`aria-label="${OPS}"`);
    expect(bootstrap?.[2]).toBe("ops");
    expect(bootstrap?.[4]).toBe("script");
  });
});

describe("workspace nav", () => {
  async function shell(): Promise<string> {
    return render(WorkspaceLayout({ children: createElement("p", null, "page body") }));
  }

  const campaignsItem = (html: string) => html.match(/<a href="\/campaigns"[^>]*>(?:<span[^>]*>.*?<\/span>)?([^<]+)<\/a>/)?.[1];

  it("links every signed-in wallet to /campaigns: Run a campaign without the role, Campaigns with it", async () => {
    expect(campaignsItem(await shell())).toBeUndefined();
    signIn(TEAM);
    expect(campaignsItem(await shell())).toBe("Run a campaign");
    await changeRole({ pubkey: TEAM, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    expect(campaignsItem(await shell())).toBe("Run a campaign");
    await changeRole({ pubkey: TEAM, role: "funder", action: "grant" }, { via: "script" }, conn);
    expect(campaignsItem(await shell())).toBe("Campaigns");
  });

  it("keeps Campaigns for a revoked funder that owns a funded campaign, and not for one that never funded", async () => {
    const { token, id } = await approvedWithCampaign();
    await escrowStep(id, "deploy");
    await revokeTeam(token);
    expect(campaignsItem(await shell())).toBe("Run a campaign");
    await conn.update(campaigns).set({ fundedAt: new Date() }).where(eq(campaigns.id, id));
    expect(campaignsItem(await shell())).toBe("Campaigns");
    // Someone else's funded campaign does not count.
    signIn(OTHER);
    expect(campaignsItem(await shell())).toBe("Run a campaign");
  });

  it("shows Admin to the ops wallet only", async () => {
    signIn(OPS);
    expect(await shell()).toContain('href="/admin"');
    await changeRole({ pubkey: OTHER, role: "funder", action: "grant" }, { via: "script" }, conn);
    await changeRole({ pubkey: OTHER, role: "reviewer", action: "grant" }, { via: "script" }, conn);
    signIn(OTHER);
    expect(await shell()).not.toContain('href="/admin"');
    world.jar.clear();
    expect(await shell()).not.toContain('href="/admin"');
  });
});

describe("where roles are written", () => {
  const ROOT = fileURLToPath(new URL("../..", import.meta.url));

  function sources(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return /\.(ts|tsx|mts|mjs|js)$/.test(e.name) ? [path] : [];
    });
  }

  function filesMatching(pattern: RegExp): string[] {
    return [...sources("src"), ...sources("scripts")]
      .filter((f) => pattern.test(readFileSync(join(ROOT, f), "utf8")))
      .map((f) => f.split(sep).join("/"))
      .sort();
  }

  it("only the role-change function inserts into or deletes from role_grant", () => {
    expect(filesMatching(/\.(insert|delete|update)\(\s*(schema\.)?roleGrants\s*\)/)).toEqual(["src/services/access.ts"]);
    expect(filesMatching(/(insert\s+into|delete\s+from|update|truncate(\s+table)?)\s+"?role_grant\b/i)).toEqual([]);
    const access = readFileSync(join(ROOT, "src/services/access.ts"), "utf8");
    expect(access.match(/\.(insert|delete|update)\(\s*roleGrants\s*\)/g)).toHaveLength(2);
    expect(access.slice(access.indexOf("export async function changeRole"), access.indexOf("export const funderRequestSchema"))).toMatch(
      /insert\(roleGrants\)[\s\S]*delete\(roleGrants\)/,
    );
  });

  it("no code updates or deletes an access-log entry, and only the role-change function writes one", () => {
    expect(filesMatching(/\.(update|delete)\(\s*(schema\.)?accessLog\s*\)/)).toEqual([]);
    expect(filesMatching(/(delete\s+from|update|truncate(\s+table)?)\s+"?access_log\b/i)).toEqual([]);
    expect(filesMatching(/\.insert\(\s*(schema\.)?accessLog\s*\)/)).toEqual(["src/services/access.ts"]);
  });
});
