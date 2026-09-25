import { Keypair, Networks, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onboardingView } from "@/components/contributor-state";
import { env } from "@/config/env";
import { horizonTrustlineReader } from "@/services/submission";
import {
  OnboardingError,
  buildChangeTrustXdr,
  fundWithFriendbot,
  hasUsdcTrustline,
  isSignatureRejection,
  readAccount,
  submitSignedXdr,
} from "@/wallet/onboarding";
import { fakeFetch } from "./fake-fetch";

const ADDR = "GCDSL5MRXQ44BWITRLP23BUUKH3OA4ITCLYAMNDDASH4BGONXKWY2NX5";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const HORIZON = "https://horizon-testnet.stellar.org";
const HASH = "a".repeat(64);

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

describe("hasUsdcTrustline", () => {
  it("maps the account state to the server gate's boolean", async () => {
    expect(await hasUsdcTrustline(ADDR, horizonReplying(404, {}).cfg)).toBe(false);
    expect(await hasUsdcTrustline(ADDR, horizonReplying(200, { sequence: "1", balances: [xlm] }).cfg)).toBe(false);
    expect(await hasUsdcTrustline(ADDR, horizonReplying(200, { sequence: "1", balances: [xlm, usdc()] }).cfg)).toBe(true);
  });
});

describe("horizonTrustlineReader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads the configured Horizon host and matches the configured USDC issuer", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("TW_API_KEY", "k".repeat(16));
    // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
    vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
    vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
    vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
    vi.stubEnv("SESSION_SECRET", "s".repeat(43));
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

describe("onboardingView", () => {
  it("ready wallet: submit enabled, both steps done", () => {
    expect(onboardingView({ status: "read", account: { kind: "ready" } })).toEqual({ step: "ready", canSubmit: true, activate: "done", trustline: "done" });
  });

  it("unfunded account: activate is the current step, submit disabled", () => {
    expect(onboardingView({ status: "read", account: { kind: "no-account" } })).toEqual({
      step: "no-account",
      canSubmit: false,
      activate: "current",
      trustline: "pending",
    });
  });

  it("no trustline: activate done, trustline current, submit disabled", () => {
    expect(onboardingView({ status: "read", account: { kind: "no-trustline", sequence: "1" } })).toEqual({
      step: "no-trustline",
      canSubmit: false,
      activate: "done",
      trustline: "current",
    });
  });

  it("Horizon down or still checking: no submit allowed", () => {
    expect(onboardingView({ status: "unreachable" }).canSubmit).toBe(false);
    expect(onboardingView({ status: "checking" }).canSubmit).toBe(false);
  });

  it("a trustline added elsewhere flips to ready on the next read", () => {
    const before = onboardingView({ status: "read", account: { kind: "no-trustline", sequence: "1" } });
    const after = onboardingView({ status: "read", account: { kind: "ready" } });
    expect([before.canSubmit, after.canSubmit]).toEqual([false, true]);
  });
});
