import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, httpStatus, isAppError } from "./errors";
import { log } from "./logger";

/**
 * Route-handler wrapper: parses the JSON body with a zod schema, maps
 * AppError to a status code, and never leaks internals on 500.
 */
type Handler<I> = (input: I, req: Request) => Promise<Response | object>;

export function jsonRoute<S extends z.ZodTypeAny>(schema: S, handler: Handler<z.infer<S>>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      let raw: unknown = {};
      if (req.method !== "GET") {
        const text = await req.text();
        raw = text ? JSON.parse(text) : {};
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.validation("invalid request", { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
      }
      const out = await handler(parsed.data, req);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof SyntaxError) {
        return NextResponse.json({ error: "VALIDATION", message: "malformed JSON" }, { status: 400 });
      }
      return errorResponse(e);
    }
  };
}

/** Maps a thrown error to a JSON error response; never leaks internals on 500. */
export function errorResponse(e: unknown): Response {
  if (isAppError(e)) {
    return NextResponse.json({ error: e.code, message: e.message, details: e.details ?? null }, { status: httpStatus(e.code) });
  }
  log.error("unhandled route error", { err: e instanceof Error ? e.message : String(e) });
  return NextResponse.json({ error: "INTERNAL", message: "internal error" }, { status: 500 });
}

/**
 * Client IP for rate-limit keys. Safe on Vercel only: the platform overwrites
 * x-forwarded-for with the connecting IP and sets x-real-ip to the same value,
 * so a client cannot spoof it. Behind another proxy or bare `next start`,
 * key on a header that proxy sets instead (see docs/deployment.md).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0]?.trim() : undefined) || req.headers.get("x-real-ip") || "unknown";
}
