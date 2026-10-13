import { z } from "zod";
import { fromStroops, toStroops } from "@/escrow/amount";

/**
 * Wallet onboarding against Horizon testnet: read the account, fund it with
 * Friendbot, open the USDC trustline. Isomorphic on purpose: the browser
 * drives the flow, and the server reuses `readAccount` to refuse a submission
 * from a wallet that cannot be paid, `readFundingSource` to record which
 * account created it, and `readFunderAccount` to refuse an escrow transaction
 * a funder's wallet could not pay for. No key ever passes through here; the
 * wallet's owner signs the trustline.
 *
 * Hosts come from config, never from user input. The only interpolated value
 * is a public key, checked against the G-address shape first.
 */

export type AccountState =
  | { kind: "no-account" }
  | { kind: "no-trustline"; sequence: string }
  | { kind: "ready" };

export interface HorizonConfig {
  horizonUrl: string;
  usdcIssuer: string;
  fetch?: typeof fetch;
}

/** Horizon reads and Friendbot give up after this long; the caller shows a retry. */
const TIMEOUT_MS = 10_000;
/** The funding source only feeds a reviewer hint, so its read gives up sooner than one a submission depends on. */
const FUNDING_SOURCE_TIMEOUT_MS = 4_000;
/** Horizon's synchronous submit waits for ledger close, which can take far longer than a read. */
const SUBMIT_TIMEOUT_MS = 60_000;

/** Base32 G-address shape. The checksum is Horizon's problem; this only keeps the URL safe. */
const G_ADDRESS = /^G[A-Z2-7]{55}$/;

export class OnboardingError extends Error {
  constructor(
    readonly kind: "unreachable" | "rejected",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OnboardingError";
  }
}

const accountSchema = z.object({
  sequence: z.string().regex(/^\d+$/),
  balances: z.array(
    z.object({
      asset_type: z.string(),
      asset_code: z.string().optional(),
      asset_issuer: z.string().optional(),
      is_authorized: z.boolean().optional(),
    }),
  ),
});

/** Horizon prints every balance and liability with up to seven decimals. */
const horizonAmount = z.string().regex(/^\d+(\.\d{1,7})?$/);

const funderAccountSchema = z.object({
  subentry_count: z.number().int().nonnegative(),
  num_sponsoring: z.number().int().nonnegative().optional(),
  num_sponsored: z.number().int().nonnegative().optional(),
  balances: z.array(
    z.object({
      asset_type: z.string(),
      asset_code: z.string().optional(),
      asset_issuer: z.string().optional(),
      is_authorized: z.boolean().optional(),
      balance: horizonAmount,
      selling_liabilities: horizonAmount.optional(),
    }),
  ),
});

/** One base reserve, in stroops: 0.5 XLM. */
const BASE_RESERVE = 5_000_000n;

/** What a wallet holds of one asset. Amounts are decimal strings. */
export interface Holding {
  balance: string;
  /** Committed to open sell offers, so not free to send. */
  sellingLiabilities: string;
  /** What a transaction can take: for USDC, balance − selling liabilities; for XLM, also minus the minimum reserve. Never below zero. */
  spendable: string;
}

export type FunderAccount =
  | { kind: "no-account" }
  | {
      kind: "account";
      /** Trustlines, offers, signers and data entries; each holds one base reserve. */
      subentries: number;
      xlm: Holding;
      /** The authorised USDC line from the configured issuer, or null when the account has none. */
      usdc: Holding | null;
    };

function holding(balance: string, sellingLiabilities: string, reserve = 0n): Holding {
  const free = toStroops(balance) - toStroops(sellingLiabilities) - reserve;
  return {
    balance: fromStroops(toStroops(balance)),
    sellingLiabilities: fromStroops(toStroops(sellingLiabilities)),
    spendable: fromStroops(free > 0n ? free : 0n),
  };
}

function checkAddress(address: string): void {
  if (!G_ADDRESS.test(address)) throw new OnboardingError("rejected", "not a Stellar public key");
}

async function call(f: typeof fetch, url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    throw new OnboardingError("unreachable", "Stellar testnet did not answer", { cause });
  }
}

/** Classifies a Horizon account body: does it hold an authorized USDC line from our issuer? */
export function classifyAccount(body: unknown, usdcIssuer: string): AccountState {
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) throw new OnboardingError("unreachable", "unexpected account response from Horizon");
  // An unauthorized line exists but cannot receive, so a release to it would fail on chain.
  const has = parsed.data.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer && b.is_authorized !== false);
  return has ? { kind: "ready" } : { kind: "no-trustline", sequence: parsed.data.sequence };
}

/** One Horizon read. 404 means the account was never funded; any other failure throws `unreachable`. */
export async function readAccount(address: string, cfg: HorizonConfig): Promise<AccountState> {
  checkAddress(address);
  const res = await call(cfg.fetch ?? fetch, `${cfg.horizonUrl}/accounts/${address}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return { kind: "no-account" };
  if (!res.ok) throw new OnboardingError("unreachable", `Horizon answered ${res.status}`);
  return classifyAccount(await res.json().catch(() => null), cfg.usdcIssuer);
}

/**
 * A Horizon account body as a funder's holdings. Spendable XLM is the balance
 * minus the minimum reserve and selling liabilities. The reserve is two base
 * reserves plus one per subentry; entries the account sponsors for others add
 * to it and entries sponsored for it come off, both zero on an ordinary wallet.
 */
export function funderAccountFrom(body: unknown, usdcIssuer: string): FunderAccount {
  const parsed = funderAccountSchema.safeParse(body);
  if (!parsed.success) throw new OnboardingError("unreachable", "unexpected account response from Horizon");
  const acct = parsed.data;
  const native = acct.balances.find((b) => b.asset_type === "native");
  if (!native) throw new OnboardingError("unreachable", "unexpected account response from Horizon");
  const entries = 2 + acct.subentry_count + (acct.num_sponsoring ?? 0) - (acct.num_sponsored ?? 0);
  const reserve = BASE_RESERVE * BigInt(Math.max(0, entries));
  // An unauthorized line cannot send, so it counts as no line, as in `classifyAccount`.
  const line = acct.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer && b.is_authorized !== false);
  return {
    kind: "account",
    subentries: acct.subentry_count,
    xlm: holding(native.balance, native.selling_liabilities ?? "0", reserve),
    usdc: line ? holding(line.balance, line.selling_liabilities ?? "0") : null,
  };
}

/**
 * One Horizon read of what a funder's wallet holds. 404 means the account was
 * never funded; any other failure throws `unreachable`. `timeoutMs` shortens
 * the wait for a page render.
 */
export async function readFunderAccount(address: string, cfg: HorizonConfig & { timeoutMs?: number }): Promise<FunderAccount> {
  checkAddress(address);
  const res = await call(cfg.fetch ?? fetch, `${cfg.horizonUrl}/accounts/${address}`, { headers: { accept: "application/json" } }, cfg.timeoutMs);
  if (res.status === 404) return { kind: "no-account" };
  if (!res.ok) throw new OnboardingError("unreachable", `Horizon answered ${res.status}`);
  return funderAccountFrom(await res.json().catch(() => null), cfg.usdcIssuer);
}

const firstOperationSchema = z.object({
  _embedded: z.object({
    records: z.array(z.object({ type: z.string(), funder: z.string().optional(), account: z.string().optional() })),
  }),
});

/**
 * The account that created `address`, from the first operation in its history,
 * or null when Horizon holds no creation record for it (first operation is not
 * this account's `create_account`, or history starts later). One Horizon read;
 * any failure throws `unreachable`.
 */
export async function readFundingSource(address: string, cfg: Pick<HorizonConfig, "horizonUrl" | "fetch">): Promise<string | null> {
  checkAddress(address);
  const res = await call(
    cfg.fetch ?? fetch,
    `${cfg.horizonUrl}/accounts/${address}/operations?order=asc&limit=1`,
    { headers: { accept: "application/json" } },
    FUNDING_SOURCE_TIMEOUT_MS,
  );
  if (!res.ok) throw new OnboardingError("unreachable", `Horizon answered ${res.status}`);
  const parsed = firstOperationSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new OnboardingError("unreachable", "unexpected operations response from Horizon");
  const first = parsed.data._embedded.records[0];
  if (!first || first.type !== "create_account" || first.account !== address) return null;
  return first.funder !== undefined && G_ADDRESS.test(first.funder) ? first.funder : null;
}

/** Server-side gate helper: true only when the account exists and trusts USDC. */
export async function hasUsdcTrustline(address: string, cfg: HorizonConfig): Promise<boolean> {
  return (await readAccount(address, cfg)).kind === "ready";
}

/**
 * Activates a testnet account with Friendbot. A 400 saying the account already
 * exists is the state we wanted; any other 400 (bad request, rate limit) is a
 * failure. The caller re-reads the account instead of trusting either reply.
 */
export async function fundWithFriendbot(address: string, cfg: { friendbotUrl: string; fetch?: typeof fetch }): Promise<void> {
  checkAddress(address);
  const res = await call(cfg.fetch ?? fetch, `${cfg.friendbotUrl}/?addr=${address}`);
  if (res.ok) return;
  if (res.status === 400) {
    const text = await res.text().catch(() => "");
    if (/createAccountAlreadyExist|op_already_exists/.test(text)) return;
  }
  throw new OnboardingError("unreachable", `Friendbot answered ${res.status}`);
}

/**
 * Unsigned `changeTrust` for USDC with the account as source. The SDK is
 * loaded on demand so only a contributor who needs the trustline downloads it.
 */
export async function buildChangeTrustXdr(
  address: string,
  sequence: string,
  cfg: { usdcIssuer: string; networkPassphrase: string },
): Promise<string> {
  checkAddress(address);
  const { Account, Asset, BASE_FEE, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  return new TransactionBuilder(new Account(address, sequence), { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", cfg.usdcIssuer) }))
    .setTimeout(300)
    .build()
    .toXDR();
}

const submitOk = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), successful: z.boolean().optional() });
const submitFail = z.object({
  extras: z.object({ result_codes: z.object({ transaction: z.string().optional(), operations: z.array(z.string()).optional() }) }).optional(),
});

/** Submits a signed envelope to Horizon and returns the tx hash. A rejected tx throws `rejected` with Horizon's result codes. */
export async function submitSignedXdr(signedXdr: string, cfg: { horizonUrl: string; fetch?: typeof fetch }): Promise<string> {
  const res = await call(cfg.fetch ?? fetch, `${cfg.horizonUrl}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ tx: signedXdr }).toString(),
  }, SUBMIT_TIMEOUT_MS);
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const ok = submitOk.safeParse(body);
    if (ok.success && ok.data.successful !== false) return ok.data.hash;
    throw new OnboardingError("unreachable", "unexpected submit response from Horizon");
  }
  if (res.status === 400) {
    const codes = submitFail.safeParse(body).data?.extras?.result_codes;
    const detail = [codes?.transaction, ...(codes?.operations ?? [])].filter(Boolean).join(", ");
    throw new OnboardingError("rejected", `Stellar rejected the transaction${detail ? ` (${detail})` : ""}`);
  }
  throw new OnboardingError("unreachable", `Horizon answered ${res.status}`);
}

/**
 * True when the wallet reported that the user declined to sign. Wallets Kit
 * normalises wallet errors to `{ code, message }`; Freighter uses code -4 for
 * a user rejection and says "rejected"/"declined" in the message.
 */
export function isSignatureRejection(e: unknown): boolean {
  if (!e || typeof e !== "object" || e instanceof OnboardingError) return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (code === -4) return true;
  return typeof message === "string" && /reject|declin|cancel|denied/i.test(message);
}

/** A message for any thrown value: Wallets Kit rejects with plain `{ code, message }` objects, not Errors. */
export function walletErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  const message = e && typeof e === "object" ? (e as { message?: unknown }).message : undefined;
  return typeof message === "string" && message ? message : "wallet error";
}
