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

  describe("rate limit", () => {
    function clock() {
      const c = { t: 0, waits: [] as number[] };
      return { c, limit: { now: () => c.t, sleep: async (ms: number) => { c.waits.push(ms); c.t += ms; } } };
    }
    const ok = { status: 200, body: { unsignedTransaction: "AAAA" } };
    const fund = (client: TrustlessWorkClient) => client.fund({ contractId: "C1", signer: "G1", amount: 1 });

    it("holds the 51st request inside 60 s until the oldest leaves the window", async () => {
      const { c, limit } = clock();
      let calls = 0;
      const client = new TrustlessWorkClient("https://tw.test", KEY, fakeFetch(() => { calls += 1; return ok; }), limit);
      for (let i = 0; i < 50; i++) {
        await fund(client);
        c.t += 100;
      }
      expect(c.waits).toEqual([]);
      await fund(client);
      expect(calls).toBe(51);
      expect(c.waits).toEqual([60_000 - 5_000]);
    });

    it("waits Retry-After on a 429 and retries once", async () => {
      const { c, limit } = clock();
      const replies = [{ status: 429, body: {}, headers: { "retry-after": "2" } }, ok];
      const client = new TrustlessWorkClient("https://tw.test", KEY, fakeFetch(() => replies.shift() ?? ok), limit);
      await expect(fund(client)).resolves.toEqual({ unsignedTransaction: "AAAA" });
      expect(c.waits).toEqual([2_000]);
    });

    it("defaults to 5 s without Retry-After and gives up after a second 429", async () => {
      const { c, limit } = clock();
      let calls = 0;
      const client = new TrustlessWorkClient("https://tw.test", KEY, fakeFetch(() => { calls += 1; return { status: 429, body: {} }; }), limit);
      await expect(fund(client)).rejects.toMatchObject({ code: "ESCROW", details: { status: 429 } });
      expect(calls).toBe(2);
      expect(c.waits).toEqual([5_000]);
    });
  });

  it("throws when the read has no row for the requested contract", async () => {
    const c = new TrustlessWorkClient(
      "https://tw.test",
      KEY,
      fakeFetch(() => ({
        status: 200,
        body: [
          {
            contractId: "C2",
            engagementId: "e",
            roles: { approver: "A", serviceProvider: "S", platformAddress: "P", releaseSigner: "A", disputeResolver: "D" },
            milestones: [],
          },
        ],
      })),
    );
    await expect(c.getEscrow("C1")).rejects.toMatchObject({ code: "ESCROW", message: "escrow not found" });
  });

  it("treats an aborted body read as unreachable", async () => {
    const c = new TrustlessWorkClient(
      "https://tw.test",
      KEY,
      fakeFetch(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("aborted"));
              },
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(c.fund({ contractId: "C1", signer: "G1", amount: 1 })).rejects.toMatchObject({
      code: "ESCROW",
      message: expect.stringMatching(/unreachable/),
    });
  });
});
