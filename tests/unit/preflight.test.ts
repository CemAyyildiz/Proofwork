import { describe, expect, it } from "vitest";
import { MIN_SERVER_XLM, preflight, type PreflightInput } from "@/domain/preflight";

const KEYS = { admin: "GADMIN00000000000000", ops: "GOPS0000000000000000", ledger: "GLEDGER0000000000000" };

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    network: "mainnet",
    serverAccounts: KEYS,
    resolver: "GRESOLVER00000000000",
    xConfigured: true,
    rateLimitConfigured: true,
    limits: { maxOpenCampaigns: 2, maxOpenBudget: "100" },
    spendableXlm: async () => "5",
    trustlessWork: async () => undefined,
    migrations: async () => ({ applied: 11, expected: 11 }),
    ...over,
  };
}

const failed = async (over: Partial<PreflightInput>) => (await preflight(input(over))).filter((l) => !l.ok).map((l) => l.text);

describe("preflight", () => {
  it("passes when every account exists, the key is accepted and the database is current", async () => {
    const lines = await preflight(input());
    expect(lines.every((l) => l.ok)).toBe(true);
    expect(lines.at(-1)?.text).toMatch(/2 open campaigns and 100 USDC.*real USDC/);
  });

  it("reports every failure, not only the first", async () => {
    const texts = await failed({
      spendableXlm: async (pubkey) => (pubkey === KEYS.admin ? null : pubkey === KEYS.ops ? String(MIN_SERVER_XLM - 1) : "5"),
      trustlessWork: async () => {
        throw new Error("trustless work 401 on /helper/get-escrows-by-signer");
      },
      xConfigured: false,
      rateLimitConfigured: false,
      migrations: async () => ({ applied: 9, expected: 11 }),
    });
    expect(texts).toHaveLength(6);
    expect(texts[0]).toMatch(/platform admin .* does not exist/);
    expect(texts[1]).toMatch(/platform ops .* has 1 XLM free and needs at least 2/);
    expect(texts[2]).toMatch(/Trustless Work refused.*401/);
    expect(texts[3]).toMatch(/X credentials are not set/);
    expect(texts[4]).toMatch(/rate limiting/);
    expect(texts[5]).toMatch(/9 of 11 migrations/);
  });

  it("refuses a resolver that is missing or is one of the server keys", async () => {
    expect((await failed({ resolver: undefined }))[0]).toMatch(/DEFAULT_DISPUTE_RESOLVER_PUBKEY is not set/);
    expect((await failed({ resolver: KEYS.ops }))[0]).toMatch(/never reaches the server/);
  });

  it("says so when Horizon or the database cannot be read, and prints no full public key", async () => {
    const lines = await preflight(
      input({
        spendableXlm: async () => {
          throw new Error("Horizon answered 503");
        },
        migrations: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    );
    const bad = lines.filter((l) => !l.ok).map((l) => l.text);
    expect(bad).toHaveLength(5);
    expect(bad[0]).toMatch(/could not be read: Horizon answered 503/);
    expect(bad[4]).toMatch(/database could not be read/);
    for (const l of lines) for (const k of [...Object.values(KEYS), "GRESOLVER00000000000"]) expect(l.text).not.toContain(k);
  });
});
