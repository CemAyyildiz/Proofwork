import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORKS } from "@/config/network";

/** The security headers next.config.ts sends on every response (CLAUDE.md §4). */
async function headersFor(network: "testnet" | "mainnet"): Promise<{ source: string; headers: Map<string, string> }[]> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", network);
  const { default: config } = await import("../../next.config");
  if (!config.headers) throw new Error("next.config has no headers()");
  const rules = await config.headers();
  return rules.map((r) => ({ source: r.source, headers: new Map(r.headers.map((h) => [h.key.toLowerCase(), h.value])) }));
}

function connectSrc(csp: string | undefined): string[] {
  const directive = (csp ?? "").split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src "));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("security headers", () => {
  it("apply to every path with CSP, HSTS, nosniff and a referrer policy", async () => {
    const rules = await headersFor("testnet");
    const all = rules.find((r) => r.source === "/(.*)");
    if (!all) throw new Error("no catch-all header rule");
    const csp = all.headers.get("content-security-policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(all.headers.get("strict-transport-security")).toMatch(/max-age=\d{8,}/);
    expect(all.headers.get("x-content-type-options")).toBe("nosniff");
    expect(all.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("let the browser reach no Trustless Work host: only the server calls it", async () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const all = (await headersFor(network)).find((r) => r.source === "/(.*)");
      expect(connectSrc(all?.headers.get("content-security-policy")).some((h) => h.includes("trustlesswork"))).toBe(false);
    }
  });

  it("let the WalletConnect relay and wallet list through, so the Varial mobile app can connect", async () => {
    const all = (await headersFor("mainnet")).find((r) => r.source === "/(.*)");
    const hosts = connectSrc(all?.headers.get("content-security-policy"));
    expect(hosts).toEqual(expect.arrayContaining(["wss://*.walletconnect.org", "https://*.walletconnect.org", "https://*.web3modal.org"]));
    expect(all?.headers.get("content-security-policy")).toContain("font-src 'self' https://fonts.reown.com");
  });

  it("on a mainnet build, let the browser reach no testnet host", async () => {
    const all = (await headersFor("mainnet")).find((r) => r.source === "/(.*)");
    const hosts = connectSrc(all?.headers.get("content-security-policy"));
    expect(hosts).toContain(NETWORKS.mainnet.horizonUrl);
    for (const h of hosts) {
      expect(h).not.toMatch(/testnet|friendbot/);
      expect(h).not.toBe(NETWORKS.testnet.horizonUrl);
    }
  });
});
