import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

/**
 * Server environment. Parsed once, on first access (see `env` below), so
 * `next build` works without it; a missing or malformed value then throws on
 * that first use instead of running with a bad config.
 *
 * Nothing in here is ever exposed to the client. The only client-visible
 * variables are the NEXT_PUBLIC_* ones in `public-env.ts`.
 */

const secretSeed = z
  .string()
  .refine((v) => StrKey.isValidEd25519SecretSeed(v), "must be a Stellar secret seed (S...)");

const publicKey = z
  .string()
  .refine((v) => StrKey.isValidEd25519PublicKey(v), "must be a Stellar public key (G...)");

/** Comma-separated G-addresses; every entry must be a valid public key. */
const publicKeyList = z
  .string()
  .transform((v) => v.split(",").map((part) => part.trim()).filter((part) => part !== ""))
  .pipe(z.array(publicKey));

/**
 * Friendbot's testnet account: the `funder` Horizon reports for every wallet
 * Friendbot creates, even when a minion account is the transaction source.
 * Read back on testnet 2026-10-12, see docs/evidence/funding-source.md.
 */
export const FRIENDBOT_ACCOUNT = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";

/** Where X sends the contributor back; `src/app/api/x/callback/route.ts` answers it. */
export const X_CALLBACK_PATH = "/api/x/callback";

/**
 * The callback and nothing else: https (http only on this machine), the
 * callback path, and no query, fragment or credentials in the URL.
 */
function isCallbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return false;
  if (url.username !== "" || url.password !== "") return false;
  // `search` and `hash` are empty for a bare "?" or "#", so the raw value is checked too.
  if (url.search !== "" || url.hash !== "" || value.includes("?") || value.includes("#")) return false;
  return url.pathname === X_CALLBACK_PATH;
}

/** `.env` templates leave optional values as empty strings; treat those as unset. */
const optional = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), inner.optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),

  STELLAR_NETWORK: z.literal("testnet"),
  HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  USDC_ISSUER: publicKey.default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),

  TW_BASE_URL: z.string().url().default("https://dev.api.trustlesswork.com"),
  TW_API_KEY: z.string().min(16),

  PLATFORM_ADMIN_SECRET: secretSeed,
  PLATFORM_OPS_SECRET: secretSeed,
  DECISION_LEDGER_SECRET: secretSeed,

  SESSION_SECRET: z.string().min(43, "at least 32 random bytes, base64-encoded"),

  UPSTASH_REDIS_REST_URL: optional(z.string().url()),
  UPSTASH_REDIS_REST_TOKEN: optional(z.string().min(1)),

  DEFAULT_DISPUTE_RESOLVER_PUBKEY: optional(publicKey),

  /** Faucets besides Friendbot whose wallets must not be linked by funding source. */
  PUBLIC_FUNDING_SOURCES: optional(publicKeyList),

  /** X: Sign in with X (OAuth 2.0 confidential client) and the app-only token. All four or none, see `load`. */
  X_CLIENT_ID: optional(z.string().min(1)),
  X_CLIENT_SECRET: optional(z.string().min(1)),
  /** Must equal a callback URL registered on the X app. The flow cookie is only sent under /api/x. */
  X_REDIRECT_URI: optional(z.string().url().refine(isCallbackUrl, `must be https://<host>${X_CALLBACK_PATH} with nothing after the path`)),
  /** App-only Bearer Token of the same X app: asks X who wrote a submitted post. It travels in a header, so no spaces or line breaks. */
  X_BEARER_TOKEN: optional(z.string().regex(/^[\x21-\x7e]+$/, "must be the token alone, with no spaces or line breaks")),
});

export type Env = z.infer<typeof schema>;

type Source = Record<string, string | undefined>;

/**
 * The Vercel Marketplace Upstash integration injects its REST credentials as
 * KV_REST_API_URL / KV_REST_API_TOKEN, marked sensitive, so they cannot be
 * copied under our names. Use them when the UPSTASH_* pair is not set.
 */
export function withKvAliases(source: Source): Source {
  const blank = (v: string | undefined) => v === undefined || v.trim() === "";
  if (!blank(source.UPSTASH_REDIS_REST_URL) || !blank(source.UPSTASH_REDIS_REST_TOKEN)) return source;
  return {
    ...source,
    UPSTASH_REDIS_REST_URL: source.KV_REST_API_URL,
    UPSTASH_REDIS_REST_TOKEN: source.KV_REST_API_TOKEN,
  };
}

function load(): Env {
  const parsed = schema.safeParse(withKvAliases(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  const seeds = [env.PLATFORM_ADMIN_SECRET, env.PLATFORM_OPS_SECRET, env.DECISION_LEDGER_SECRET];
  if (new Set(seeds).size !== seeds.length) {
    throw new Error("Invalid environment: server signing keys must be distinct");
  }
  const x = [env.X_CLIENT_ID, env.X_CLIENT_SECRET, env.X_REDIRECT_URI, env.X_BEARER_TOKEN].filter((v) => v !== undefined);
  if (x.length !== 0 && x.length !== 4) {
    throw new Error("Invalid environment: set X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI and X_BEARER_TOKEN together, or none of them");
  }
  return env;
}

let cached: Env | undefined;

/**
 * Lazily parsed on first access so `next build` can import server modules
 * without a full environment; any real use at runtime still fails fast.
 */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string | symbol) {
    cached ??= load();
    return cached[prop as keyof Env];
  },
});

/**
 * Accounts anyone can get a wallet from, so sharing one says nothing about who
 * is behind it: Friendbot always, plus the configured faucets. Configuration
 * only; never built from user input.
 */
export function publicFundingSources(): ReadonlySet<string> {
  return new Set([FRIENDBOT_ACCOUNT, ...(env.PUBLIC_FUNDING_SOURCES ?? [])]);
}

export interface XConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  bearerToken: string;
}

/**
 * The X app's credentials, or null when the deployment has none. Sign in with
 * X is then off and no post's author can be checked, so no submission is accepted.
 */
export function xConfig(): XConfig | null {
  const { X_CLIENT_ID: clientId, X_CLIENT_SECRET: clientSecret, X_REDIRECT_URI: redirectUri, X_BEARER_TOKEN: bearerToken } = env;
  // `load` guarantees all four or none.
  if (clientId === undefined || clientSecret === undefined || redirectUri === undefined || bearerToken === undefined) return null;
  return { clientId, clientSecret, redirectUri, bearerToken };
}
