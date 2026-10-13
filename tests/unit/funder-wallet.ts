import type { FunderLimits } from "@/config/env";
import { fakeFetch, type FakeReply } from "./fake-fetch";
import type { FunderAccountReader } from "@/services/campaign";
import type { FunderAccount, Holding } from "@/wallet/onboarding";

/** Circle's testnet USDC issuer, the default `USDC_ISSUER`. */
export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * A Horizon account body, trimmed to what the funder read uses. `usdc: null`
 * leaves the trustline out. Balances are printed with seven decimals, as
 * Horizon prints them.
 */
export function horizonAccount(usdc: string | null, xlm = "10000.0000000", issuer = USDC_ISSUER) {
  const line = {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: issuer,
    balance: usdc,
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    is_authorized: true,
  };
  const native = { asset_type: "native", balance: xlm, buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" };
  return { sequence: "4242", subentry_count: usdc === null ? 0 : 1, num_sponsoring: 0, num_sponsored: 0, balances: usdc === null ? [native] : [line, native] };
}

/**
 * `fetch` stand-in that answers one request only: Horizon's account read for
 * a G-address. Any other URL throws, so a test fails if the code under it
 * starts asking for something else.
 */
export function horizonAccountsOnly(reply: (url: string) => FakeReply, asked: string[] = []): typeof fetch {
  return fakeFetch((url) => {
    if (!/^https:\/\/[^/]+\/accounts\/G[A-Z2-7]{55}$/.test(url)) throw new Error(`unexpected fetch: ${url}`);
    asked.push(url);
    return reply(url);
  });
}

const holds = (spendable: string): Holding => ({ balance: spendable, sellingLiabilities: "0", spendable });

/** A funder wallet as `readFunderAccount` reports it. `usdc: null` is an account without the trustline. */
export function wallet(usdc: string | null, xlm = "100"): FunderAccount {
  return { kind: "account", subentries: usdc === null ? 0 : 1, xlm: holds(xlm), usdc: usdc === null ? null : holds(usdc) };
}

/** Stand-in for the Horizon reader: answers with one account and counts its reads. */
export function reading(account: FunderAccount): FunderAccountReader & { reads: number } {
  const reader = Object.assign(
    async () => {
      reader.reads += 1;
      return account;
    },
    { reads: 0 },
  );
  return reader;
}

/** The default caps. */
export const LIMITS: FunderLimits = { maxOpenCampaigns: 2, maxOpenBudget: "100" };

/** For suites that are not about caps or readiness: the default caps and a wallet that can fund anything they create. */
export const openGate = () => ({ limits: LIMITS, account: reading(wallet("1000")) });
