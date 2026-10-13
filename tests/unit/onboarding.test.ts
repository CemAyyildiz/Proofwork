import { Keypair, Networks, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onboardingView } from "@/components/contributor-state";
import { env } from "@/config/env";
import { horizonFunderAccountReader } from "@/services/campaign";
import { horizonFundingSourceReader, horizonTrustlineReader } from "@/services/submission";
import {
  OnboardingError,
  buildChangeTrustXdr,
  fundWithFriendbot,
  hasUsdcTrustline,
  isSignatureRejection,
  readAccount,
  readFunderAccount,
  readFundingSource,
  submitSignedXdr,
  walletErrorMessage,
} from "@/wallet/onboarding";
import { fakeFetch } from "./fake-fetch";
import { horizonAccount } from "./funder-wallet";

const ADDR = "GCDSL5MRXQ44BWITRLP23BUUKH3OA4ITCLYAMNDDASH4BGONXKWY2NX5";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const HORIZON = "https://horizon-testnet.stellar.org";
const HASH = "a".repeat(64);
const FRIENDBOT = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const OPS_URL = `${HORIZON}/accounts/${ADDR}/operations?order=asc&limit=1`;

/** Horizon's operations page, trimmed to the fields a first record carries. */
const operations = (...records: Array<Record<string, unknown>>) => ({ _links: {}, _embedded: { records } });
const createdBy = (funder: string, account = ADDR) => ({
  id: "20970147757953025",
  type: "create_account",
  type_i: 0,
  transaction_successful: true,
  source_account: funder,
  starting_balance: "10000.0000000",
  funder,
  account,
});

const xlm = { asset_type: "native", balance: "10000.0000000" };
const usdc = (issuer = ISSUER) => ({ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: issuer, balance: "0" });

function horizonReplying(status: number, body: unknown) {
  const seen: string[] = [];
  const f = fakeFetch((url) => {
    seen.push(url);
    return { status, body };
  });
  return { cfg: { horizonUrl: HORIZON, usdcIssuer: ISSUER, fetch: f }, seen };
}

describe("readAccount", () => {
  it("reads a ready wallet when a USDC line from the configured issuer exists", async () => {
    const { cfg, seen } = horizonReplying(200, { sequence: "123", balances: [xlm, usdc()] });
    expect(await readAccount(ADDR, cfg)).toEqual({ kind: "ready" });
    expect(seen).toEqual([`${HORIZON}/accounts/${ADDR}`]);
  });

  it("reads no-account on a Horizon 404 (unfunded)", async () => {
    const { cfg } = horizonReplying(404, { status: 404 });
    expect(await readAccount(ADDR, cfg)).toEqual({ kind: "no-account" });
  });

  it("reads no-trustline, with the sequence for the changeTrust, when USDC is missing", async () => {
    const { cfg } = horizonReplying(200, { sequence: "4242", balances: [xlm] });
    expect(await readAccount(ADDR, cfg)).toEqual({ kind: "no-trustline", sequence: "4242" });
  });

  it("does not count a USDC line the issuer has not authorized", async () => {
    const { cfg } = horizonReplying(200, { sequence: "7", balances: [xlm, { ...usdc(), is_authorized: false }] });
    expect(await readAccount(ADDR, cfg)).toEqual({ kind: "no-trustline", sequence: "7" });
    const ok = horizonReplying(200, { sequence: "7", balances: [xlm, { ...usdc(), is_authorized: true }] });
    expect((await readAccount(ADDR, ok.cfg)).kind).toBe("ready");
  });

  it("does not count a USDC line from another issuer", async () => {
    const { cfg } = horizonReplying(200, { sequence: "1", balances: [xlm, usdc("GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG")] });
    expect((await readAccount(ADDR, cfg)).kind).toBe("no-trustline");
  });

  it("throws unreachable when Horizon is down or answers garbage", async () => {
    await expect(readAccount(ADDR, horizonReplying(503, {}).cfg)).rejects.toMatchObject({ kind: "unreachable" });
    await expect(readAccount(ADDR, horizonReplying(200, { nope: true }).cfg)).rejects.toMatchObject({ kind: "unreachable" });
    const down = {
      horizonUrl: HORIZON,
      usdcIssuer: ISSUER,
      fetch: (async () => {
        throw new TypeError("network");
      }) as typeof fetch,
    };
    await expect(readAccount(ADDR, down)).rejects.toBeInstanceOf(OnboardingError);
  });

  it("refuses anything that is not a G-address before building a URL", async () => {
    const { cfg, seen } = horizonReplying(200, {});
    await expect(readAccount("../../evil", cfg)).rejects.toMatchObject({ kind: "rejected" });
    expect(seen).toEqual([]);
  });
});

describe("readFunderAccount", () => {
  /** The native and USDC lines of an account body, with any fields replaced. */
  function account(over: { subentries?: number; sponsoring?: number; sponsored?: number; xlm?: Record<string, unknown>; usdc?: Record<string, unknown> | null }) {
    const base = horizonAccount("25.5000000", "10.0000000");
    const [line, native] = base.balances;
    return {
      ...base,
      subentry_count: over.subentries ?? 1,
      num_sponsoring: over.sponsoring ?? 0,
      num_sponsored: over.sponsored ?? 0,
      balances: [...(over.usdc === null ? [] : [{ ...line, ...over.usdc }]), { ...native, ...over.xlm }],
    };
  }

  it("reads the native and USDC balances with one request to the account", async () => {
    const { cfg, seen } = horizonReplying(200, account({}));
    expect(await readFunderAccount(ADDR, cfg)).toEqual({
      kind: "account",
      subentries: 1,
      // 10 XLM minus (2 + 1 subentry) × 0.5 XLM of reserve.
      xlm: { balance: "10", sellingLiabilities: "0", spendable: "8.5" },
      usdc: { balance: "25.5", sellingLiabilities: "0", spendable: "25.5" },
    });
    expect(seen).toEqual([`${HORIZON}/accounts/${ADDR}`]);
  });

  it("reads no-account on a Horizon 404", async () => {
    expect(await readFunderAccount(ADDR, horizonReplying(404, { status: 404 }).cfg)).toEqual({ kind: "no-account" });
  });

  it.each([
    ["no subentries", { subentries: 0 }, "9"],
    ["five subentries", { subentries: 5 }, "6.5"],
    ["selling liabilities come off", { xlm: { selling_liabilities: "3.2500000" } }, "5.25"],
    ["buying liabilities do not", { xlm: { buying_liabilities: "4.0000000" } }, "8.5"],
    ["entries it sponsors for others add to the reserve", { sponsoring: 2 }, "7.5"],
    ["entries sponsored for it come off the reserve", { sponsored: 1 }, "9"],
  ])("spendable XLM is balance minus reserve minus selling liabilities: %s", async (_label, over, spendable) => {
    const read = await readFunderAccount(ADDR, horizonReplying(200, account(over)).cfg);
    expect(read).toMatchObject({ kind: "account", xlm: { balance: "10", spendable } });
  });

  it("never reports less than zero spendable XLM", async () => {
    const read = await readFunderAccount(ADDR, horizonReplying(200, account({ subentries: 30 })).cfg);
    expect(read).toMatchObject({ xlm: { balance: "10", spendable: "0" } });
    const exact = await readFunderAccount(ADDR, horizonReplying(200, account({ xlm: { balance: "1.5000000" } })).cfg);
    expect(exact).toMatchObject({ xlm: { spendable: "0" } });
  });

  it("keeps amounts exact where a float would not", async () => {
    const big = account({ xlm: { balance: "9007199254740993.0000001" }, usdc: { balance: "0.1000000", selling_liabilities: "0.0000001" } });
    expect(await readFunderAccount(ADDR, horizonReplying(200, big).cfg)).toMatchObject({
      xlm: { balance: "9007199254740993.0000001", spendable: "9007199254740991.5000001" },
      usdc: { balance: "0.1", sellingLiabilities: "0.0000001", spendable: "0.0999999" },
    });
  });

  it("spendable USDC is the balance minus selling liabilities", async () => {
    const read = await readFunderAccount(ADDR, horizonReplying(200, account({ usdc: { selling_liabilities: "5.5000000" } })).cfg);
    expect(read).toMatchObject({ usdc: { balance: "25.5", sellingLiabilities: "5.5", spendable: "20" } });
  });

  it("reports no USDC line when there is none, when the issuer is another, or when the line is not authorised", async () => {
    const other = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
    for (const body of [account({ usdc: null }), account({ usdc: { asset_issuer: other } }), account({ usdc: { is_authorized: false } })]) {
      expect(await readFunderAccount(ADDR, horizonReplying(200, body).cfg)).toMatchObject({ kind: "account", usdc: null });
    }
  });

  it("throws unreachable on a non-200, a body it does not recognise or no answer", async () => {
    for (const status of [429, 500, 503]) {
      await expect(readFunderAccount(ADDR, horizonReplying(status, {}).cfg)).rejects.toMatchObject({ kind: "unreachable" });
    }
    const garbage = [{ nope: true }, { ...account({}), subentry_count: "1" }, account({ xlm: { balance: "1e3" } }), { ...account({}), balances: [] }];
    for (const body of garbage) {
      await expect(readFunderAccount(ADDR, horizonReplying(200, body).cfg)).rejects.toMatchObject({ kind: "unreachable" });
    }
    const timedOut = {
      horizonUrl: HORIZON,
      usdcIssuer: ISSUER,
      fetch: (async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as typeof fetch,
    };
    await expect(readFunderAccount(ADDR, timedOut)).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("gives up after the timeout it is given", async () => {
    const hangs = {
      horizonUrl: HORIZON,
      usdcIssuer: ISSUER,
      timeoutMs: 20,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof fetch,
    };
    await expect(readFunderAccount(ADDR, hangs)).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("refuses anything that is not a G-address before building a URL", async () => {
    const { cfg, seen } = horizonReplying(200, account({}));
    await expect(readFunderAccount("../../evil", cfg)).rejects.toMatchObject({ kind: "rejected" });
    await expect(readFunderAccount(`${ADDR}/../x`, cfg)).rejects.toMatchObject({ kind: "rejected" });
    expect(seen).toEqual([]);
  });
});

describe("readFundingSource", () => {
  it("returns the funder of the account's create_account, read as its first operation", async () => {
    const { cfg, seen } = horizonReplying(200, operations(createdBy(ISSUER)));
    expect(await readFundingSource(ADDR, cfg)).toBe(ISSUER);
    expect(seen).toEqual([OPS_URL]);
  });

  it("reports Friendbot's account even when a minion account sent the transaction", async () => {
    const minion = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
    const { cfg } = horizonReplying(200, operations({ ...createdBy(FRIENDBOT), source_account: minion }));
    expect(await readFundingSource(ADDR, cfg)).toBe(FRIENDBOT);
  });

  it("is unknown when the first operation is not a create_account", async () => {
    const payment = { type: "payment", from: ISSUER, to: ADDR, amount: "5.0000000" };
    expect(await readFundingSource(ADDR, horizonReplying(200, operations(payment)).cfg)).toBeNull();
  });

  it("is unknown when Horizon holds no operation for the account", async () => {
    expect(await readFundingSource(ADDR, horizonReplying(200, operations()).cfg)).toBeNull();
  });

  it("is unknown when the create_account is for another account or names no usable funder", async () => {
    const other = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
    expect(await readFundingSource(ADDR, horizonReplying(200, operations(createdBy(ISSUER, other))).cfg)).toBeNull();
    expect(await readFundingSource(ADDR, horizonReplying(200, operations({ type: "create_account", account: ADDR })).cfg)).toBeNull();
    expect(await readFundingSource(ADDR, horizonReplying(200, operations(createdBy("not-an-address"))).cfg)).toBeNull();
  });

  it("throws unreachable on a non-200, a garbage body or no answer", async () => {
    for (const status of [404, 429, 503]) {
      await expect(readFundingSource(ADDR, horizonReplying(status, {}).cfg)).rejects.toMatchObject({ kind: "unreachable" });
    }
    await expect(readFundingSource(ADDR, horizonReplying(200, { nope: true }).cfg)).rejects.toMatchObject({ kind: "unreachable" });
    const timedOut = {
      horizonUrl: HORIZON,
      fetch: (async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as typeof fetch,
    };
    await expect(readFundingSource(ADDR, timedOut)).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("refuses anything that is not a G-address before building a URL", async () => {
    const { cfg, seen } = horizonReplying(200, operations());
    await expect(readFundingSource("../../evil", cfg)).rejects.toMatchObject({ kind: "rejected" });
    await expect(readFundingSource(`${ADDR}/../x`, cfg)).rejects.toMatchObject({ kind: "rejected" });
    expect(seen).toEqual([]);
  });
});

describe("hasUsdcTrustline", () => {
  it("maps the account state to the server gate's boolean", async () => {
    expect(await hasUsdcTrustline(ADDR, horizonReplying(404, {}).cfg)).toBe(false);
    expect(await hasUsdcTrustline(ADDR, horizonReplying(200, { sequence: "1", balances: [xlm] }).cfg)).toBe(false);
    expect(await hasUsdcTrustline(ADDR, horizonReplying(200, { sequence: "1", balances: [xlm, usdc()] }).cfg)).toBe(true);
  });
});

describe("default Horizon readers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubServerEnv(): void {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
  }

  it("reads the configured Horizon host and matches the configured USDC issuer", async () => {
    stubServerEnv();
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: { sequence: "1", balances: [xlm, usdc(env.USDC_ISSUER)] } };
      }),
    );
    expect(await horizonTrustlineReader(ADDR)).toBe(true);
    expect(seen).toEqual([`${env.HORIZON_URL}/accounts/${ADDR}`]);
  });

  it("reads a funder's wallet from the configured Horizon host and matches the configured USDC issuer", async () => {
    stubServerEnv();
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: horizonAccount("40.0000000", "10.0000000", env.USDC_ISSUER) };
      }),
    );
    expect(await horizonFunderAccountReader()(ADDR)).toMatchObject({ kind: "account", usdc: { spendable: "40" }, xlm: { spendable: "8.5" } });
    expect(await horizonFunderAccountReader(4_000)(ADDR)).toMatchObject({ kind: "account" });
    expect(seen).toEqual([`${env.HORIZON_URL}/accounts/${ADDR}`, `${env.HORIZON_URL}/accounts/${ADDR}`]);
  });

  it("the funder reader gives up after the timeout it was built with, not the default", async () => {
    stubServerEnv();
    // A Horizon that never answers: the request ends only when its signal aborts it.
    vi.stubGlobal("fetch", ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch);
    const started = performance.now();
    await expect(horizonFunderAccountReader(150)(ADDR)).rejects.toMatchObject({ kind: "unreachable" });
    const elapsed = performance.now() - started;
    // Near 150 ms: not before it, and nowhere near the 10 s a read waits by default.
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("reads the funding source from the configured Horizon host, with the wallet as the only variable", async () => {
    stubServerEnv();
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: operations(createdBy(FRIENDBOT)) };
      }),
    );
    expect(await horizonFundingSourceReader(ADDR)).toBe(FRIENDBOT);
    expect(seen).toEqual([`${env.HORIZON_URL}/accounts/${ADDR}/operations?order=asc&limit=1`]);
  });
});

describe("fundWithFriendbot", () => {
  it("calls the configured Friendbot host for the address", async () => {
    const seen: string[] = [];
    const f = fakeFetch((url) => {
      seen.push(url);
      return { status: 200, body: { hash: HASH } };
    });
    await fundWithFriendbot(ADDR, { friendbotUrl: "https://friendbot.stellar.org", fetch: f });
    expect(seen).toEqual([`https://friendbot.stellar.org/?addr=${ADDR}`]);
  });

  it("accepts a 400 only when the account already exists: the caller re-reads the account", async () => {
    for (const body of [{ detail: "createAccountAlreadyExist" }, { extras: { result_codes: { operations: ["op_already_exists"] } } }]) {
      const f = fakeFetch(() => ({ status: 400, body }));
      await expect(fundWithFriendbot(ADDR, { friendbotUrl: "https://friendbot.stellar.org", fetch: f })).resolves.toBeUndefined();
    }
  });

  it("throws on any other 400 (bad request, rate limit)", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { title: "Bad Request", detail: "rate limited" } }));
    await expect(fundWithFriendbot(ADDR, { friendbotUrl: "https://friendbot.stellar.org", fetch: f })).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("throws on a Friendbot failure so the form stays disabled", async () => {
    const f = fakeFetch(() => ({ status: 502, body: {} }));
    await expect(fundWithFriendbot(ADDR, { friendbotUrl: "https://friendbot.stellar.org", fetch: f })).rejects.toMatchObject({ kind: "unreachable" });
  });
});

describe("buildChangeTrustXdr", () => {
  it("builds one USDC changeTrust from the contributor's account on testnet", async () => {
    const xdr = await buildChangeTrustXdr(ADDR, "4242", { usdcIssuer: ISSUER, networkPassphrase: Networks.TESTNET });
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    expect(tx.source).toBe(ADDR);
    expect(tx.sequence).toBe("4243");
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as Operation.ChangeTrust;
    expect(op.type).toBe("changeTrust");
    expect(op.line).toMatchObject({ code: "USDC", issuer: ISSUER });
  });
});

describe("submitSignedXdr", () => {
  it("posts the envelope form-encoded and returns the hash", async () => {
    let body = "";
    const f = fakeFetch((url, init) => {
      expect(url).toBe(`${HORIZON}/transactions`);
      body = String(init.body);
      return { status: 200, body: { hash: HASH, successful: true } };
    });
    expect(await submitSignedXdr("AAAA+/=", { horizonUrl: HORIZON, fetch: f })).toBe(HASH);
    expect(new URLSearchParams(body).get("tx")).toBe("AAAA+/=");
  });

  it("surfaces Horizon result codes on a rejected transaction", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_low_reserve"] } } } }));
    await expect(submitSignedXdr("AAAA", { horizonUrl: HORIZON, fetch: f })).rejects.toThrow("tx_failed, op_low_reserve");
  });
});

describe("isSignatureRejection", () => {
  it("recognises a wallet decline and nothing else", () => {
    expect(isSignatureRejection({ code: -4, message: "whatever" })).toBe(true);
    expect(isSignatureRejection({ code: -1, message: "The user rejected this request." })).toBe(true);
    expect(isSignatureRejection(new OnboardingError("rejected", "Stellar rejected the transaction (tx_bad_seq)"))).toBe(false);
    expect(isSignatureRejection({ code: -1, message: "Freighter is not connected" })).toBe(false);
    expect(isSignatureRejection("nope")).toBe(false);
  });
});

describe("walletErrorMessage", () => {
  it("reads the message of an Error and of a wallet's plain rejection object", () => {
    expect(walletErrorMessage(new Error("boom"))).toBe("boom");
    expect(walletErrorMessage({ code: -1, message: "Freighter is not connected" })).toBe("Freighter is not connected");
    expect(walletErrorMessage({ code: -1 })).toBe("wallet error");
    expect(walletErrorMessage("nope")).toBe("wallet error");
  });
});

describe("onboardingView", () => {
  /** X is connected and configured: the wallet check alone decides. */
  const X_OPEN = { connected: true, available: true };
  const READY = { status: "read", account: { kind: "ready" } } as const;

  it("ready wallet: submit enabled, both steps done", () => {
    expect(onboardingView(READY, X_OPEN)).toEqual({ step: "ready", canSubmit: true, activate: "done", trustline: "done" });
  });

  it("unfunded account: activate is the current step, submit disabled", () => {
    expect(onboardingView({ status: "read", account: { kind: "no-account" } }, X_OPEN)).toEqual({
      step: "no-account",
      canSubmit: false,
      activate: "current",
      trustline: "pending",
    });
  });

  it("no trustline: activate done, trustline current, submit disabled", () => {
    expect(onboardingView({ status: "read", account: { kind: "no-trustline", sequence: "1" } }, X_OPEN)).toEqual({
      step: "no-trustline",
      canSubmit: false,
      activate: "done",
      trustline: "current",
    });
  });

  it("Horizon down or still checking: no submit allowed", () => {
    expect(onboardingView({ status: "unreachable" }, X_OPEN).canSubmit).toBe(false);
    expect(onboardingView({ status: "checking" }, X_OPEN).canSubmit).toBe(false);
  });

  it("a trustline added elsewhere flips to ready on the next read", () => {
    const before = onboardingView({ status: "read", account: { kind: "no-trustline", sequence: "1" } }, X_OPEN);
    const after = onboardingView(READY, X_OPEN);
    expect([before.canSubmit, after.canSubmit]).toEqual([false, true]);
  });

  it("ready wallet without an X account: the wallet steps are done, submit stays disabled", () => {
    expect(onboardingView(READY, { connected: false, available: true })).toEqual({ step: "ready", canSubmit: false, activate: "done", trustline: "done" });
  });

  it("ready wallet with an X account on a deployment without X credentials: submit stays disabled", () => {
    expect(onboardingView(READY, { connected: true, available: false })).toEqual({ step: "ready", canSubmit: false, activate: "done", trustline: "done" });
  });

  it("neither connected nor configured: submit disabled", () => {
    expect(onboardingView(READY, { connected: false, available: false }).canSubmit).toBe(false);
  });

  it("an X account does not open the form for a wallet that cannot be paid", () => {
    expect(onboardingView({ status: "read", account: { kind: "no-trustline", sequence: "1" } }, X_OPEN).canSubmit).toBe(false);
  });
});
