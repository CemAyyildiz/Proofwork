import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { explorerFor, NETWORKS, parseNetwork } from "@/config/network";
import { describeMissing } from "@/domain/funding-readiness";

vi.mock("server-only", () => ({}));

describe("parseNetwork", () => {
  it("reads unset and blank as testnet, and refuses anything that is not a network", () => {
    expect(parseNetwork(undefined)).toBe("testnet");
    expect(parseNetwork("  ")).toBe("testnet");
    expect(parseNetwork("testnet")).toBe("testnet");
    expect(parseNetwork("mainnet")).toBe("mainnet");
    expect(() => parseNetwork("public")).toThrow(/testnet.*mainnet/);
    expect(() => parseNetwork("MAINNET")).toThrow();
  });
});

describe("explorerFor", () => {
  it("links mainnet under /public and testnet under /testnet", () => {
    expect(explorerFor("mainnet").tx("ab")).toBe("https://stellar.expert/explorer/public/tx/ab");
    expect(explorerFor("testnet").contract("C1")).toBe("https://stellar.expert/explorer/testnet/contract/C1");
    expect(explorerFor("mainnet").account("G1")).toBe("https://stellar.expert/explorer/public/account/G1");
  });
});

describe("describeMissing on mainnet", () => {
  it("never points at Friendbot or a faucet", () => {
    const lines = [
      describeMissing({ item: "account" }, "mainnet"),
      describeMissing({ item: "trustline" }, "mainnet"),
      describeMissing({ item: "usdc", have: "3", need: "50" }, "mainnet"),
      describeMissing({ item: "xlm", have: "0.2", need: "1.5", forTrustline: true }, "mainnet"),
    ];
    for (const line of lines) expect(line).not.toMatch(/friendbot|faucet|testnet/i);
    expect(lines[0]).toMatch(/Send XLM/);
    expect(lines[2]).toMatch(/has 3 USDC.*budget is 50 USDC.*on the Stellar network/);
    expect(lines[3]).toMatch(/0\.5 XLM of it for the reserve/);
  });
});

describe("server environment per network", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The environment is parsed once per module instance, so each case loads its own. */
  async function load(server: string, built: string | undefined, extra: Record<string, string> = {}) {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", server);
    if (built !== undefined) vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", built);
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
    for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
    const mod = await import("@/config/env");
    // The proxy parses on first read.
    return { env: mod.env, horizon: mod.env.HORIZON_URL, sources: () => mod.publicFundingSources() };
  }

  it("takes Horizon, the USDC issuer and the Trustless Work host from the network", async () => {
    const t = await load("testnet", undefined);
    expect([t.env.HORIZON_URL, t.env.USDC_ISSUER, t.env.TW_BASE_URL]).toEqual([
      NETWORKS.testnet.horizonUrl,
      NETWORKS.testnet.usdcIssuer,
      NETWORKS.testnet.twBaseUrl,
    ]);
    const m = await load("mainnet", "mainnet");
    expect([m.env.HORIZON_URL, m.env.USDC_ISSUER, m.env.TW_BASE_URL]).toEqual([
      "https://horizon.stellar.org",
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "https://api.trustlesswork.com",
    ]);
  });

  it("refuses a server network that differs from the one the bundle was built for", async () => {
    await expect(load("mainnet", undefined)).rejects.toThrow(/STELLAR_NETWORK is mainnet but the app was built for testnet/);
    await expect(load("testnet", "mainnet")).rejects.toThrow(/STELLAR_NETWORK is testnet but the app was built for mainnet/);
  });

  it("refuses testnet hosts and any other USDC issuer on mainnet", async () => {
    await expect(load("mainnet", "mainnet", { USDC_ISSUER: NETWORKS.testnet.usdcIssuer })).rejects.toThrow(/USDC_ISSUER/);
    await expect(load("mainnet", "mainnet", { HORIZON_URL: NETWORKS.testnet.horizonUrl })).rejects.toThrow(/HORIZON_URL/);
    await expect(load("mainnet", "mainnet", { TW_BASE_URL: NETWORKS.testnet.twBaseUrl })).rejects.toThrow(/TW_BASE_URL/);
  });

  it("does not treat Friendbot's address as a public funding source on mainnet", async () => {
    const exchange = Keypair.random().publicKey();
    expect([...(await load("mainnet", "mainnet")).sources()]).toEqual([]);
    expect([...(await load("mainnet", "mainnet", { PUBLIC_FUNDING_SOURCES: exchange })).sources()]).toEqual([exchange]);
  });
});

describe("custody and fees page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("states the limits of this deployment, the protocol fee and who signs", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
    vi.stubEnv("FUNDER_MAX_OPEN_CAMPAIGNS", "3");
    vi.stubEnv("FUNDER_MAX_OPEN_BUDGET", "250");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: CustodyPage } = await import("@/app/(public)/custody/page");
    const html = renderToStaticMarkup(CustodyPage());
    expect(html).toContain("3 campaigns open at a time");
    expect(html).toContain("250 USDC of open budget");
    expect(html).toContain("Trustless Work protocol fee: 0.3%");
    expect(html).toContain("Proofwork platform fee: 0%");
    expect(html).toContain("No payout leaves the escrow without your signature");
    // The sealed-review exception is only told where that mode is switched on.
    expect(html).not.toContain("founder-sealed");
  });
});
