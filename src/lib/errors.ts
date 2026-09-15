/**
 * Typed application errors. Every boundary (server action, route handler,
 * script) maps these to a response; nothing else throws raw strings.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "ESCROW"
  | "LEDGER"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }

  static validation(message: string, details?: Record<string, unknown>): AppError {
    return new AppError("VALIDATION", message, details);
  }
  static unauthenticated(message = "authentication required"): AppError {
    return new AppError("UNAUTHENTICATED", message);
  }
  static forbidden(message = "not allowed"): AppError {
    return new AppError("FORBIDDEN", message);
  }
  static notFound(what: string): AppError {
    return new AppError("NOT_FOUND", `${what} not found`);
  }
  static conflict(message: string): AppError {
    return new AppError("CONFLICT", message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function httpStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "ESCROW":
    case "LEDGER":
      return 502;
    case "INTERNAL":
      return 500;
  }
}

/**
 * True when a Postgres unique constraint rejected the write (SQLSTATE 23505).
 * Drizzle wraps driver errors, so the `cause` chain is walked; postgres-js and
 * PGlite both expose the SQLSTATE as `code`.
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
