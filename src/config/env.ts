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
