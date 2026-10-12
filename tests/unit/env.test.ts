import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRIENDBOT_ACCOUNT, withKvAliases } from "@/config/env";

describe("withKvAliases", () => {
  it("uses the Vercel KV REST pair when the Upstash pair is unset", () => {
    const out = withKvAliases({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" });
    expect(out.UPSTASH_REDIS_REST_URL).toBe("https://kv.example");
    expect(out.UPSTASH_REDIS_REST_TOKEN).toBe("t");
  });

  it("treats empty Upstash values as unset", () => {
    const out = withKvAliases({ UPSTASH_REDIS_REST_URL: " ", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" });
    expect(out.UPSTASH_REDIS_REST_URL).toBe("https://kv.example");
  });

  it("never mixes the two pairs once either Upstash value is set", () => {
    const src = { UPSTASH_REDIS_REST_URL: "https://up.example", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" };
    expect(withKvAliases(src)).toBe(src);
  });
});

describe("publicFundingSources", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The environment is parsed once per module instance, so each case loads its own. */
  async function withEnv(value: string | undefined): Promise<ReadonlySet<string>> {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
    if (value !== undefined) vi.stubEnv("PUBLIC_FUNDING_SOURCES", value);
    return (await import("@/config/env")).publicFundingSources();
  }

  it("is Friendbot's testnet account alone when nothing is configured", async () => {
    expect([...(await withEnv(undefined))]).toEqual([FRIENDBOT_ACCOUNT]);
    expect([...(await withEnv("  "))]).toEqual([FRIENDBOT_ACCOUNT]);
  });

  it("adds the configured faucets to Friendbot, tolerating spaces and a trailing comma", async () => {
    const [a, b] = [Keypair.random().publicKey(), Keypair.random().publicKey()];
    expect([...(await withEnv(` ${a}, ${b},`))]).toEqual([FRIENDBOT_ACCOUNT, a, b]);
  });

  it("refuses an entry that is not a Stellar public key instead of dropping it", async () => {
    const good = Keypair.random().publicKey();
    await expect(withEnv(`${good},not-a-key`)).rejects.toThrow(/PUBLIC_FUNDING_SOURCES.*must be a Stellar public key/s);
    // Right shape, wrong checksum.
    await expect(withEnv(`${good.slice(0, -1)}${good.endsWith("A") ? "B" : "A"}`)).rejects.toThrow(/PUBLIC_FUNDING_SOURCES/);
  });
});
