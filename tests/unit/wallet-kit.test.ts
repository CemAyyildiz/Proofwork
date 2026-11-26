import { beforeEach, describe, expect, it, vi } from "vitest";

const kit = vi.hoisted(() => ({
  /** Times the kit module itself was evaluated. */
  loads: 0,
  init: vi.fn(),
  signTransaction: vi.fn(async () => ({ signedTxXdr: "SIGNED" })),
}));

vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => {
  kit.loads += 1;
  return { StellarWalletsKit: { init: kit.init, signTransaction: kit.signTransaction } };
});
vi.mock("@creit.tech/stellar-wallets-kit/modules/varial", () => ({ VarialModule: class {}, VARIAL_ID: "varial" }));

beforeEach(() => {
  // A fresh `@/wallet/kit` per test, so its cached load starts empty.
  vi.resetModules();
  kit.loads = 0;
  kit.init.mockReset();
  kit.signTransaction.mockClear();
});

describe("the wallet kit loader", () => {
  it("loads and initialises nothing on import", async () => {
    await import("@/wallet/kit");
    expect(kit.loads).toBe(0);
    expect(kit.init).not.toHaveBeenCalled();
  });

  it("two concurrent wallet actions initialise the kit once", async () => {
    const { signTransaction } = await import("@/wallet/kit");
    expect(await Promise.all([signTransaction("G_A", "X1"), signTransaction("G_A", "X2")])).toEqual(["SIGNED", "SIGNED"]);
    expect(kit.init).toHaveBeenCalledTimes(1);
    // Always selects Varial: a stored "freighter" from before the rename matches no module.
    expect(kit.init).toHaveBeenCalledWith(expect.objectContaining({ selectedWalletId: "varial" }));
    expect(kit.signTransaction).toHaveBeenCalledTimes(2);
    await signTransaction("G_A", "X3");
    expect(kit.init).toHaveBeenCalledTimes(1);
  });

  it("a load that failed is tried again on the next action", async () => {
    kit.init.mockImplementationOnce(() => {
      throw new Error("chunk failed");
    });
    const { signTransaction } = await import("@/wallet/kit");
    await expect(signTransaction("G_A", "X1")).rejects.toThrow("chunk failed");
    expect(kit.signTransaction).not.toHaveBeenCalled();
    expect(await signTransaction("G_A", "X2")).toBe("SIGNED");
    expect(kit.init).toHaveBeenCalledTimes(2);
  });
});

describe("the wallet layer's API calls", () => {
  it("report the status, not a parse error, when the server answers with a non-JSON page", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { logout } = await import("@/wallet/kit");
      await expect(logout()).rejects.toThrow("request failed (502)");
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("report the server's message when the error body is JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "RATE_LIMITED", message: "too many requests" }, { status: 429 })));
    try {
      const { logout } = await import("@/wallet/kit");
      await expect(logout()).rejects.toThrow("too many requests");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
