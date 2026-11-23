import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/wallet/kit", () => ({ signTransaction: async () => "" }));

const { call, runError } = await import("@/components/escrow-actions");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("escrow action requests", () => {
  it("an HTML error page answers with its status instead of a JSON parse error", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    await expect(call("cmp_1", { action: "prepare", kind: "fund" })).rejects.toThrow("request failed (502)");
  });

  it("a JSON refusal keeps the server's message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "campaign is closed" }, { status: 409 }));
    await expect(call("cmp_1", { action: "prepare", kind: "fund" })).rejects.toThrow("campaign is closed");
  });

  it("a wallet rejection reads as a cancelled signature", () => {
    expect(runError("sign", { code: -4, message: "User rejected the request" })).toBe("Signature cancelled");
    expect(runError("sign", new Error("wallet locked"))).toBe("wallet locked");
  });

  it("an error after the signed transaction was sent says it may have landed", () => {
    expect(runError("submit", new Error("request failed (504)."))).toBe(
      "request failed (504). The transaction may have reached the chain: refresh the page before trying again.",
    );
    expect(runError("prepare", new Error("deploy the escrow first"))).toBe("deploy the escrow first");
  });
});
