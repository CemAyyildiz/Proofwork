import { fromStroops, toStroops } from "@/escrow/amount";
import type { FunderAccount } from "@/wallet/onboarding";

/**
 * Whether a funder's wallet can pay for the escrow transactions it is about
 * to sign. Pure rules shared by the campaign service, the campaign page and
 * the readiness panel. No I/O: the account comes from one Horizon read.
 */

/**
 * Spendable XLM a wallet must hold for each escrow transaction it still has
 * to sign. Measured on testnet from the Week 1 run in
 * docs/evidence/escrow-cycle.md, read on Horizon 2026-10-13:
 *
 *   deploy 31c9dd13adcad008bd8b82f1a16c3b3265005faf5024c730f7b065e5de5dcff4
 *          fee charged 0.0380569 XLM, fee bid 0.0444693 XLM
 *   fund   9fe69bb62061c736e1ed6f885803a4488c78947ba5b59348ed8966da863894ba
 *          fee charged 0.0298443 XLM, fee bid 0.0698270 XLM
 *
 * The network rejects a transaction whose fee bid the account cannot cover,
 * so the bid is what counts. 0.5 XLM is about seven times the larger bid.
 */
export const TX_FEE_FLOOR_XLM = "0.5";

/** One base reserve: what a new trustline locks up in the account that opens it. */
export const TRUSTLINE_RESERVE_XLM = "0.5";

/** Circle's testnet faucet; it lists Stellar Testnet. Checked 2026-10-13. */
export const USDC_FAUCET_URL = "https://faucet.circle.com";

/** The escrow transaction the funder signs next. Deploy is followed by fund, so it needs the fees of both. */
export type FundingStep = "deploy" | "fund";

/** One thing the wallet lacks. Amounts are decimal strings. */
export type MissingItem =
  | { item: "account" }
  | { item: "trustline" }
  | { item: "usdc"; have: string; need: string }
  /** `forTrustline`: the need includes the reserve the missing USDC trustline will lock up. */
  | { item: "xlm"; have: string; need: string; forTrustline?: true };

export type FundingReadiness =
  | { status: "ready"; usdc: string; xlm: string }
  | { status: "not-ready"; missing: MissingItem[] }
  /** Horizon could not answer, so nothing is known about the wallet. */
  | { status: "unchecked" };

/** XLM the wallet must have free for the fees still ahead of it. */
export function feeFloor(step: FundingStep): string {
  const perTx = toStroops(TX_FEE_FLOOR_XLM);
  return fromStroops(step === "deploy" ? perTx * 2n : perTx);
}

/**
 * Every missing item at once, each judged on its own: a wallet with no
 * account also has no trustline, no USDC and no XLM, and all four are listed.
 */
export function assessFunding(account: FunderAccount, budget: string, step: FundingStep): Exclude<FundingReadiness, { status: "unchecked" }> {
  const noLine = account.kind === "no-account" || !account.usdc;
  // Adding the trustline takes one base reserve out of what is free now, so the fees must be free on top of it.
  const fees = toStroops(feeFloor(step)) + (noLine ? toStroops(TRUSTLINE_RESERVE_XLM) : 0n);
  const need = { usdc: fromStroops(toStroops(budget)), xlm: fromStroops(fees) };
  const usdc = account.kind === "account" && account.usdc ? account.usdc.spendable : "0";
  const xlm = account.kind === "account" ? account.xlm.spendable : "0";
  const missing: MissingItem[] = [];
  if (account.kind === "no-account") missing.push({ item: "account" });
  if (noLine) missing.push({ item: "trustline" });
  if (toStroops(usdc) < toStroops(need.usdc)) missing.push({ item: "usdc", have: usdc, need: need.usdc });
  if (toStroops(xlm) < fees) missing.push({ item: "xlm", have: xlm, need: need.xlm, ...(noLine ? { forTrustline: true as const } : {}) });
  return missing.length === 0 ? { status: "ready", usdc, xlm } : { status: "not-ready", missing };
}

/** One sentence per missing item: what is wrong and what to do about it. */
export function describeMissing(m: MissingItem): string {
  switch (m.item) {
    case "account":
      return "The account does not exist on Stellar testnet yet. Activate it: Friendbot creates it with testnet XLM.";
    case "trustline":
      return "The account has no USDC trustline. Add the USDC trustline so the wallet can hold the budget.";
    case "usdc":
      return `The wallet has ${m.have} USDC to spend and the budget is ${m.need} USDC. Testnet USDC comes from Circle's faucet (${USDC_FAUCET_URL}, network Stellar Testnet).`;
    case "xlm":
      return `The wallet has ${m.have} XLM free for network fees and needs ${m.need} XLM${
        m.forTrustline ? `, ${TRUSTLINE_RESERVE_XLM} XLM of it for the reserve the USDC trustline will hold` : ""
      }. Send testnet XLM to it; reserves and open offers are not counted as free.`;
  }
}
