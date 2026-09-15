import { describe, expect, it } from "vitest";
import { TrustlessWorkClient } from "@/escrow/trustless-work/client";
import { fakeFetch } from "./fake-fetch";

const KEY = "k".repeat(20);

describe("TrustlessWorkClient (v1)", () => {
  it("sends x-api-key and parses the unsignedTransaction shape", async () => {
    let seenKey = "";
    const c = new TrustlessWorkClient(
      "https://tw.test",
      KEY,
      fakeFetch((url, init) => {
        seenKey = (init.headers as Record<string, string>)["x-api-key"] ?? "";
        expect(url).toBe("https://tw.test/escrow/multi-release/fund-escrow");
        return { status: 200, body: { unsignedTransaction: "AAAA" } };
      }),
    );
    const r = await c.fund({ contractId: "C1", signer: "G1", amount: 10 });
    expect(r.unsignedTransaction).toBe("AAAA");
    expect(seenKey).toBe(KEY);
  });

  it("fails loudly when the response shape drifts", async () => {
    const c = new TrustlessWorkClient("https://tw.test", KEY, fakeFetch(() => ({ status: 200, body: { unsignedXdr: "v2-field" } })));
    await expect(c.fund({ contractId: "C1", signer: "G1", amount: 10 })).rejects.toThrow(/shape drifted/);
  });

  it("surfaces non-2xx as ESCROW errors with status", async () => {
    const c = new TrustlessWorkClient("https://tw.test", KEY, fakeFetch(() => ({ status: 401, body: { message: "bad key" } })));
    await expect(c.getEscrow("C1")).rejects.toMatchObject({ code: "ESCROW", details: { status: 401 } });
  });

  it("reads an escrow by contract id with validateOnChain", async () => {
    const c = new TrustlessWorkClient(
      "https://tw.test",
      KEY,
      fakeFetch((url) => {
        expect(url).toContain("/helper/get-escrow-by-contract-ids?contractIds%5B%5D=C1&validateOnChain=true");
        return {
          status: 200,
          body: [
            {
              contractId: "C1",
              engagementId: "e",
              balance: "10",
              roles: { approver: "A", serviceProvider: "S", platformAddress: "P", releaseSigner: "A", disputeResolver: "D" },
              milestones: [{ description: "m", amount: 2, receiver: "R", flags: { approved: true } }],
            },
          ],
        };
      }),
    );
    const e = await c.getEscrow("C1");
    expect(e.milestones[0]?.flags?.approved).toBe(true);
  });
});
