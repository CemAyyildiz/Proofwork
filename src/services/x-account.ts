import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { db, type Db } from "@/db/client";
import { xAccounts } from "@/db/schema";
import { pubkeySchema } from "@/domain/wallet-auth";
import { returnSlugSchema, xUserIdSchema, type XOutcome } from "@/domain/x-connect";
import { AppError, isAppError, isUniqueViolation } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { XPort } from "@/x/port";

/**
 * Connecting an X account to a wallet (SPEC CAP-6). One X account per wallet
 * and one wallet per X account, enforced by `x_account`'s two unique keys.
 * Only the X account ID is written; there is no unlink.
 */

// ---- binding ---------------------------------------------------------------

export type XConflict = "x_taken" | "wallet_bound";

function conflict(reason: XConflict): AppError {
  const message = reason === "x_taken" ? "this X account is connected to another wallet" : "this wallet already has an X account";
  return new AppError("CONFLICT", message, { reason });
}

/**
 * Binds the pair, or does nothing when exactly this pair is already bound.
 * Throws CONFLICT with `details.reason` when either side is bound elsewhere;
 * the database decides, so two racing binds cannot both win.
 */
export async function bindXAccount(pubkey: string, xUserId: string, conn: Db = db): Promise<void> {
  const pk = pubkeySchema.parse(pubkey);
  const id = xUserIdSchema.parse(xUserId);
  try {
    await conn.insert(xAccounts).values({ pubkey: pk, xUserId: id });
    return;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  const mine = (await conn.select().from(xAccounts).where(eq(xAccounts.pubkey, pk)).limit(1))[0];
  if (mine?.xUserId === id) return;
  throw conflict(mine ? "wallet_bound" : "x_taken");
}

/** The wallet's connected X account, or null. The ID is for server-side checks, never for a page. */
export async function xAccountFor(pubkey: string, conn: Db = db): Promise<{ xUserId: string; connectedAt: Date } | null> {
  const row = (await conn.select().from(xAccounts).where(eq(xAccounts.pubkey, pubkey)).limit(1))[0];
  return row ? { xUserId: row.xUserId, connectedAt: row.connectedAt } : null;
}

// ---- flow state --------------------------------------------------------------

/**
 * The state of one connect attempt travels in a signed cookie: `state`, the
 * PKCE verifier, the wallet that started it, the campaign to return to and
 * the expiry. Nothing about a flow is stored server-side.
 */
export const FLOW_COOKIE = "pw_x_flow";
/** How long a started flow may be finished. */
export const FLOW_TTL_SECONDS = 10 * 60;
/**
 * The browser keeps the cookie longer than the flow lives, so a callback that
 * arrives late still knows which campaign page to say "try again" on. Past
 * `exp` the server refuses the state and verifier whatever the cookie's age.
 */
const FLOW_COOKIE_MAX_AGE_SECONDS = 60 * 60;

const flowSchema = z.object({
  st: z.string().min(32).max(64),
  cv: z.string().min(43).max(128),
  pk: pubkeySchema,
  slug: returnSlugSchema,
  exp: z.number().int(),
});
type Flow = z.infer<typeof flowSchema>;

/** Sent only to the two X routes, never to pages, and never readable by scripts. */
export function flowCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: string; maxAge: number } {
  return { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/api/x", maxAge: FLOW_COOKIE_MAX_AGE_SECONDS };
}

/**
 * Signed with a key derived from SESSION_SECRET for this purpose alone, so a
 * session token never verifies as flow state and flow state never as a session.
 */
function sign(body: string): string {
  const key = createHmac("sha256", env.SESSION_SECRET).update("proofwork:x-flow:v1").digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface StartedFlow {
  /** cookie value */
  token: string;
  state: string;
  /** S256 challenge of the verifier held in the cookie */
  codeChallenge: string;
}

export function createFlow(pubkey: string, slug: string, now = Date.now()): StartedFlow {
  const flow: Flow = {
    st: randomBytes(32).toString("base64url"),
    cv: randomBytes(32).toString("base64url"),
    pk: pubkeySchema.parse(pubkey),
    slug: returnSlugSchema.parse(slug),
    exp: Math.floor(now / 1000) + FLOW_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return {
    token: `${body}.${sign(body)}`,
    state: flow.st,
    codeChallenge: createHash("sha256").update(flow.cv).digest("base64url"),
  };
}

/** The flow a cookie value carries, if this server signed it. Says nothing about expiry or whose it is. */
function readFlow(token: string | undefined): Flow | null {
  if (!token) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length > 0) return null;
  if (!sameString(sig, sign(body))) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = flowSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** The campaign a signed flow cookie returns to, for answers given before the flow is checked. */
export function flowSlug(token: string | undefined): string | null {
  return readFlow(token)?.slug ?? null;
}

/**
 * The verifier of a flow that may be finished: signed here, not expired,
 * started by this wallet, and answering with the `state` it was issued.
 */
export function verifyFlow(
  token: string | undefined,
  expected: { pubkey: string; state: string | undefined },
  now = Date.now(),
): { codeVerifier: string } | null {
  const flow = readFlow(token);
  if (!flow) return null;
  if (flow.exp * 1000 <= now) return null;
  if (flow.pk !== expected.pubkey) return null;
  if (expected.state === undefined || !sameString(flow.st, expected.state)) return null;
  return { codeVerifier: flow.cv };
}

// ---- the two steps -------------------------------------------------------------

export const connectQuerySchema = z.object({ slug: returnSlugSchema });

/** What X sends back: `code` and `state` on approval, `error` and `state` otherwise. */
export const callbackQuerySchema = z.object({
  state: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(2000).optional(),
  error: z.string().min(1).max(100).optional(),
});
export type CallbackQuery = z.infer<typeof callbackQuerySchema>;

export type Started =
  | { to: "x"; url: string; flowToken: string }
  | { to: "campaign"; outcome: XOutcome };

/** Step 1: send a signed-in wallet to X, or say why not. `x` is null when X is not configured. */
export function startConnect(input: { pubkey: string | null; slug: string; x: XPort | null; now?: number }): Started {
  if (!input.pubkey) return { to: "campaign", outcome: "signin" };
  if (!input.x) return { to: "campaign", outcome: "unavailable" };
  const flow = createFlow(input.pubkey, input.slug, input.now);
  return { to: "x", url: input.x.authorizeUrl({ state: flow.state, codeChallenge: flow.codeChallenge }), flowToken: flow.token };
}

export interface FinishInput {
  /** the session wallet, null when not signed in */
  pubkey: string | null;
  /** the flow cookie as received; the caller clears it whatever the outcome */
  flowToken: string | undefined;
  query: CallbackQuery;
  x: XPort | null;
  conn?: Db;
  now?: number;
}

/**
 * Step 2: X sent the contributor back. Binds only when the flow state holds
 * for the session wallet and X names the account; X is not called otherwise.
 * `slug` is null when no cookie of ours says where the flow started.
 */
export async function finishConnect(input: FinishInput): Promise<{ slug: string | null; outcome: XOutcome }> {
  const slug = flowSlug(input.flowToken);
  const done = (outcome: XOutcome) => ({ slug, outcome });

  if (!input.pubkey) return done("signin");
  const flow = verifyFlow(input.flowToken, { pubkey: input.pubkey, state: input.query.state }, input.now);
  if (!flow) return done("retry");
  if (input.query.error !== undefined) return done(input.query.error === "access_denied" ? "cancelled" : "x_failed");
  if (input.query.code === undefined) return done("retry");
  if (!input.x) return done("unavailable");

  let xUserId: string;
  try {
    ({ xUserId } = await input.x.identify({ code: input.query.code, codeVerifier: flow.codeVerifier }));
  } catch (e) {
    // Only the adapter's own step, reason and status: never the code, verifier or anything X sent.
    log.warn("x did not identify the account", isAppError(e) && e.code === "X" ? { ...e.details } : { reason: "unexpected" });
    return done("x_failed");
  }

  try {
    await bindXAccount(input.pubkey, xUserId, input.conn);
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") return done(e.details?.["reason"] === "x_taken" ? "taken" : "wallet_bound");
    throw e;
  }
  return done("connected");
}
