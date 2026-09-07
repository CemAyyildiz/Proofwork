import { describe, expect, it } from "vitest";
import { TrustlessWorkClient } from "@/escrow/trustless-work/client";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("TrustlessWorkClient", () => {
  it("sends x-api-key and parses the unsignedXdr shape", async () => {
    let seenKey = "";
    const c = new TrustlessWorkClient(
      "https://tw.test",
      "k".repeat(20),
      fakeFetch((url, init) => {
        seenKey = (init.headers as Record<string, string>)["x-api-key"] ?? "";
        expect(url).toBe("https://tw.test/escrow/multi-release/v2/fund");
        return { status: 200, body: { unsignedXdr: "AAAA", txHash: "h" } };
      }),
    );
    const r = await c.fund({ contractId: "C1", signer: "G1", amount: 10 });
    expect(r.unsignedXdr).toBe("AAAA");
    expect(seenKey).toBe("k".repeat(20));
  });

  it("fails loudly when the response shape drifts", async () => {
    const c = new TrustlessWorkClient("https://tw.test", "k".repeat(20), fakeFetch(() => ({ status: 200, body: { unsignedTransaction: "old-v1-field" } })));
    await expect(c.fund({ contractId: "C1", signer: "G1", amount: 10 })).rejects.toThrow(/shape drifted/);
  });

  it("surfaces non-2xx as ESCROW errors with status", async () => {
    const c = new TrustlessWorkClient("https://tw.test", "k".repeat(20), fakeFetch(() => ({ status: 401, body: { message: "bad key" } })));
    await expect(c.getEscrow("C1")).rejects.toMatchObject({ code: "ESCROW", details: { status: 401 } });
  });
});
