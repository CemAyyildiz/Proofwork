/**
 * Structured JSON logger. Redacts anything that looks like a Stellar secret
 * seed or an API key before it reaches stdout. Use this, never console.*.
 */
type Level = "debug" | "info" | "warn" | "error";

const SECRET_PATTERNS = [/S[A-Z2-7]{55}/g, /(x-api-key|api[_-]?key|token|secret)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce<string>((s, re) => s.replace(re, "[redacted]"), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(fields ? (redact(fields) as object) : {}) });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env["NODE_ENV"] !== "production") emit("debug", msg, fields);
  },
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
