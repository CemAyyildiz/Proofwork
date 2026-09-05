import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "@/config/env";

/**
 * HMAC-signed session cookie. Payload is public-key + expiry only; roles are
 * always re-read from the database so a revoked grant takes effect at once.
 */
const COOKIE = "pw_session";
const TTL_SECONDS = 60 * 60 * 24;

const payloadSchema = z.object({
  pk: z.string().regex(/^G[A-Z2-7]{55}$/),
  exp: z.number().int(),
  iat: z.number().int(),
});
export type Session = z.infer<typeof payloadSchema>;

function sign(data: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(data).digest("base64url");
}

export function encodeSession(pk: string, now = Date.now()): string {
  const payload: Session = { pk, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (!parsed.success) return null;
  if (parsed.data.exp * 1000 < now) return null;
  return parsed.data;
}

export async function setSessionCookie(pk: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encodeSession(pk), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE)?.value);
}
