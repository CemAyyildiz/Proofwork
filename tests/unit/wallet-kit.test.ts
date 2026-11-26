import { beforeEach, describe, expect, it, vi } from "vitest";
import { walletConnectProjectId } from "@/config/public-env";

const kit = vi.hoisted(() => ({
  /** Times the kit module itself was evaluated. */
  loads: 0,
  /** The wallet id the kit restored or was given; undefined = none matches a module. */
  selected: undefined as string | undefined,
  init: vi.fn(),
  setWallet: vi.fn((id: string) => {
    kit.selected = id;
  }),
  signTransaction: vi.fn(async () => ({ signedTxXdr: "SIGNED" })),
  /** Params each WalletConnectModule was built with. */
  wcParams: [] as unknown[],
  projectId: null as string | null,
}));

vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => {
  kit.loads += 1;
  return {
    StellarWalletsKit: {
      init: kit.init,
      setWallet: kit.setWallet,
      signTransaction: kit.signTransaction,
      get selectedModule() {
        if (!kit.selected) throw { code: -3, message: "Please set the wallet first" };
        return { productId: kit.selected };
      },
    },
  };
});
vi.mock("@creit.tech/stellar-wallets-kit/modules/varial", () => ({ VarialModule: class {}, VARIAL_ID: "varial" }));
vi.mock("@creit.tech/stellar-wallets-kit/modules/wallet-connect", () => ({
  WalletConnectModule: class {
    productId = "wallet_connect";
    constructor(params: unknown) {
      kit.wcParams.push(params);
    }
  },
  WalletConnectTargetChain: { PUBLIC: "stellar:pubnet", TESTNET: "stellar:testnet" },
}));
vi.mock("@/config/public-env", async (orig) => {
  const real = await orig<typeof import("@/config/public-env")>();
  return {
    ...real,
    publicEnv: new Proxy(real.publicEnv, { get: (t, k) => (k === "walletConnectProjectId" ? kit.projectId : t[k as keyof typeof t]) }),
  };
});

beforeEach(() => {
  // A fresh `@/wallet/kit` per test, so its cached load starts empty.
  vi.resetModules();
  kit.loads = 0;
  kit.selected = undefined;
  kit.projectId = null;
  kit.wcParams = [];
  kit.init.mockReset();
  kit.setWallet.mockClear();
  kit.signTransaction.mockClear();
});

const modulesOf = () => (kit.init.mock.calls[0]?.[0] as { modules: { productId?: string }[] }).modules;

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
    expect(kit.signTransaction).toHaveBeenCalledTimes(2);
    await signTransaction("G_A", "X3");
    expect(kit.init).toHaveBeenCalledTimes(1);
  });

  it("selects Varial when the stored wallet matches no module, as an old \"freighter\" id does", async () => {
    const { signTransaction } = await import("@/wallet/kit");
    await signTransaction("G_A", "X1");
    expect(kit.setWallet).toHaveBeenCalledWith("varial");
  });

  it("keeps a stored wallet that matches a module, so a phone on WalletConnect stays on it", async () => {
    kit.selected = "wallet_connect";
    const { signTransaction } = await import("@/wallet/kit");
    await signTransaction("G_A", "X1");
    expect(kit.setWallet).not.toHaveBeenCalled();
  });

  it("offers only the Varial extension without a WalletConnect project ID", async () => {
    const { signTransaction } = await import("@/wallet/kit");
    await signTransaction("G_A", "X1");
    expect(modulesOf()).toHaveLength(1);
    expect(kit.wcParams).toEqual([]);
  });

  it("adds WalletConnect for the Varial mobile app when a project ID is set, on the build's network", async () => {
    kit.projectId = "0123456789abcdef0123456789abcdef";
    vi.stubGlobal("window", { location: { origin: "https://proofwork.online" } });
    try {
      const { signTransaction } = await import("@/wallet/kit");
      await signTransaction("G_A", "X1");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(modulesOf().map((m) => m.productId)).toEqual([undefined, "wallet_connect"]);
    expect(kit.wcParams).toEqual([
      expect.objectContaining({
        projectId: "0123456789abcdef0123456789abcdef",
        metadata: expect.objectContaining({ name: "Proofwork", url: "https://proofwork.online", icons: ["https://proofwork.online/icon.svg"] }),
        allowedChains: [expect.stringMatching(/^stellar:(pubnet|testnet)$/)],
      }),
    ]);
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

describe("the WalletConnect project ID", () => {
  it("is taken only when it is 32 hex characters", () => {
    expect(walletConnectProjectId("0123456789abcdef0123456789ABCDEF")).toBe("0123456789abcdef0123456789ABCDEF");
    expect(walletConnectProjectId(" 0123456789abcdef0123456789abcdef \n")).toBe("0123456789abcdef0123456789abcdef");
    for (const bad of [undefined, "", "YOUR_PROJECT_ID", "0123456789abcdef", "g123456789abcdef0123456789abcdef"]) expect(walletConnectProjectId(bad)).toBeNull();
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
