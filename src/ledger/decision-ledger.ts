import {
  Horizon,
  Keypair,
  Memo,
  NetworkError,
  NotFoundError,
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { canonicalJson, decisionHash, ledgerKey, ledgerValue, type DecisionRecord } from "./canonical";

/**
 * Writes one classic Stellar transaction per decision from the decision
 * ledger account (AD-5):
 *   - manage_data  key = pw:<shortId>[:a1]   value = "v2|PASS|R00_PASS|<hash8>" (v1 for records scored under rubric v1)
 *   - memo_hash    = sha256(canonical decision JSON)
 *
 * The transaction hash is the decision's on-chain reference. The memo lets
 * anyone verify the stored record was not altered after the fact.
 *
 * Signing and submitting are separate steps so the caller can store the
 * signed envelope and its hash before anything reaches the network. A
 * submission whose answer is lost can then be looked up by that hash, and
 * resent unchanged, instead of being rebuilt into a second, different
 * transaction under the same key.
 */

/** A decision transaction, signed and not yet known to be on chain. */
export interface SignedDecision {
  /** Hex hash of the signed transaction: its on-chain reference once it lands. */
  txHash: string;
  /** Base64 transaction envelope, exactly as signed. */
  envelopeXdr: string;
  /** The envelope's maxTime: after this no ledger will accept it. */
  expiresAt: Date;
}

/** What Horizon knows about a transaction hash. */
export type DecisionTxStatus = "success" | "failed" | "not_found";

export interface DecisionLedger {
  /** Builds and signs the record's transaction. Nothing is sent. */
  sign(record: DecisionRecord): Promise<SignedDecision>;
  /**
   * Sends a signed envelope. Resolves once it is in a ledger. Throws
   * `DecisionRejectedError` when the network refused it for good and
   * `DecisionPendingError` when the outcome is not known.
   */
  submit(signed: SignedDecision): Promise<void>;
  /** Looks a transaction up by hash. Throws `DecisionPendingError` when the network cannot answer. */
  status(txHash: string): Promise<DecisionTxStatus>;
}

/** The network refused the transaction; it is not on chain and will not be. */
export class DecisionRejectedError extends AppError {
  constructor(detail: string, cause?: unknown) {
    super("LEDGER", `decision commit rejected: ${detail}`, undefined, { cause });
  }
}

/**
 * The transaction was sent but whether it landed is not known (timeout,
 * server error, lost connection). It may still be applied, so nothing is
 * rebuilt or freed: a later call looks its hash up and finishes it.
 */
export class DecisionPendingError extends AppError {
  constructor(cause?: unknown) {
    super("LEDGER", "the decision was sent but the network has not confirmed it yet; try again in two minutes", undefined, { cause });
  }
}

/**
 * Maximum fee bid per decision transaction, in stroops (0.001 XLM). A
 * classic fee is a ceiling, not a price: outside surge pricing the network
 * charges its minimum (100 stroops per operation) whatever the bid. A fixed
 * bid of 100x the minimum keeps decisions landing through moderate surges
 * without an extra fee lookup per decision, and bounds the worst case at
 * 0.001 XLM. A bid of BASE_FEE would be dropped in any surge, leaving the
 * decision waiting on a retry.
 */
export const DECISION_FEE_STROOPS = "10000";

/** Seconds a signed decision transaction stays valid. */
export const DECISION_TX_TIMEOUT_S = 60;

export class HorizonDecisionLedger implements DecisionLedger {
  private readonly server: Horizon.Server;
  private readonly signer: Keypair;
  private readonly passphrase: string;

  constructor(opts: { horizonUrl: string; ledgerSecret: string; networkPassphrase: string; server?: Horizon.Server }) {
    this.server = opts.server ?? new Horizon.Server(opts.horizonUrl);
    this.signer = Keypair.fromSecret(opts.ledgerSecret);
    this.passphrase = opts.networkPassphrase;
  }

  get publicKey(): string {
    return this.signer.publicKey();
  }

  async sign(record: DecisionRecord): Promise<SignedDecision> {
    const key = ledgerKey(record.submission, record.appealOf !== null);
    let account;
    try {
      account = await this.server.loadAccount(this.signer.publicKey());
    } catch (cause) {
      if (cause instanceof NotFoundError) {
        throw new AppError("LEDGER", "decision ledger account not found on network", { account: this.publicKey }, { cause });
      }
      throw new AppError("LEDGER", `could not load the decision ledger account: ${horizonDetail(cause)}`, { account: this.publicKey }, { cause });
    }

    const tx = new TransactionBuilder(account, { fee: DECISION_FEE_STROOPS, networkPassphrase: this.passphrase })
      .addOperation(Operation.manageData({ name: key, value: ledgerValue(record) }))
      .addMemo(Memo.hash(decisionHash(record)))
      .setTimeout(DECISION_TX_TIMEOUT_S)
      .build();
    tx.sign(this.signer);
    return { txHash: tx.hash().toString("hex"), envelopeXdr: tx.toEnvelope().toXDR("base64"), expiresAt: expiryOf(tx) };
  }

  async submit(signed: SignedDecision): Promise<void> {
    const tx = TransactionBuilder.fromXDR(signed.envelopeXdr, this.passphrase);
    try {
      await this.server.submitTransaction(tx, { skipMemoRequiredCheck: true });
      log.info("decision committed", { txHash: signed.txHash });
    } catch (cause) {
      if (isDefinitiveRejection(cause)) throw new DecisionRejectedError(horizonDetail(cause), cause);
      log.warn("decision submission outcome unknown", { txHash: signed.txHash, err: horizonDetail(cause) });
      throw new DecisionPendingError(cause);
    }
  }

  async status(txHash: string): Promise<DecisionTxStatus> {
    try {
      const tx = await this.server.transactions().transaction(txHash).call();
      return tx.successful ? "success" : "failed";
    } catch (cause) {
      if (cause instanceof NotFoundError) return "not_found";
      throw new DecisionPendingError(cause);
    }
  }

  /** Signs and submits in one step. For scripts only: the app stores the envelope in between (services/review.ts). */
  async commit(record: DecisionRecord): Promise<{ txHash: string; ledgerKey: string; decisionHash: string; canonicalJson: string }> {
    const signed = await this.sign(record);
    await this.submit(signed);
    return {
      txHash: signed.txHash,
      ledgerKey: ledgerKey(record.submission, record.appealOf !== null),
      decisionHash: decisionHash(record).toString("hex"),
      canonicalJson: canonicalJson(record),
    };
  }
}

function expiryOf(tx: Transaction): Date {
  const maxTime = Number(tx.timeBounds?.maxTime ?? "0");
  if (!Number.isFinite(maxTime) || maxTime <= 0) throw new Error("decision transaction has no expiry");
  return new Date(maxTime * 1000);
}

/**
 * Horizon's answer when stellar-core refused the envelope: HTTP 400 with
 * transaction result codes (tx_bad_seq, tx_insufficient_fee, tx_bad_auth,
 * tx_too_late, tx_failed with an operation error, malformed). The SDK hands
 * this over either as the HTTP client's error (`response.data` is the body)
 * or as a `BadResponseError` whose `response` is the body itself, so both
 * places are read.
 */
const rejectionBody = z.object({
  status: z.literal(400),
  extras: z.object({ result_codes: z.object({ transaction: z.string() }).loose() }),
});

function resultCodes(e: unknown): unknown {
  if (typeof e !== "object" || e === null || !("response" in e)) return null;
  const res: unknown = e.response;
  const nested: unknown = typeof res === "object" && res !== null && "data" in res ? res.data : undefined;
  for (const body of [res, nested]) {
    const parsed = rejectionBody.safeParse(body);
    if (parsed.success) return parsed.data.extras.result_codes;
  }
  return null;
}

/**
 * True when stellar-core refused the envelope: it is not in the queue and
 * will not be applied. Everything else (timeouts, 5xx, rate limits, lost
 * connections) leaves the envelope possibly in flight.
 */
function isDefinitiveRejection(e: unknown): boolean {
  return resultCodes(e) !== null;
}

function horizonDetail(e: unknown): string {
  const codes = resultCodes(e);
  if (codes !== null) return JSON.stringify(codes);
  if (e instanceof NetworkError) {
    const res: unknown = e.getResponse();
    if (typeof res === "object" && res !== null && "status" in res && typeof res.status === "number") return `http ${res.status}`;
  }
  return e instanceof Error ? e.message : "unknown";
}

/**
 * In-memory ledger for unit tests: deterministic fake hashes, no network.
 * `commits` holds every record whose transaction "landed".
 */
export class FakeDecisionLedger implements DecisionLedger {
  readonly commits: Array<{ txHash: string; record: DecisionRecord }> = [];
  private readonly signed = new Map<string, DecisionRecord>();

  async sign(record: DecisionRecord): Promise<SignedDecision> {
    const txHash = `fake_${decisionHash(record).toString("hex").slice(0, 16)}`;
    this.signed.set(txHash, record);
    return { txHash, envelopeXdr: txHash, expiresAt: new Date(Date.now() + DECISION_TX_TIMEOUT_S * 1000) };
  }

  async submit(signed: SignedDecision): Promise<void> {
    const record = this.signed.get(signed.txHash);
    if (!record) throw new DecisionRejectedError("unknown envelope");
    if (!this.commits.some((c) => c.txHash === signed.txHash)) this.commits.push({ txHash: signed.txHash, record });
  }

  async status(txHash: string): Promise<DecisionTxStatus> {
    return this.commits.some((c) => c.txHash === txHash) ? "success" : "not_found";
  }
}
