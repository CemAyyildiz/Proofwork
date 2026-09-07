import {
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { canonicalJson, decisionHash, ledgerKey, ledgerValue, type DecisionRecord } from "./canonical";

/**
 * Writes one classic Stellar transaction per decision from the decision
 * ledger account (AD-5):
 *   - manage_data  key = pw:<shortId>[:a1]   value = "v1|PASS|R00_PASS|<hash8>"
 *   - memo_hash    = sha256(canonical decision JSON)
 *
 * The transaction hash is the decision's on-chain reference. The memo lets
 * anyone verify the stored record was not altered after the fact.
 */
export interface CommittedDecision {
  txHash: string;
  ledgerKey: string;
  decisionHash: string;
  canonicalJson: string;
}

export interface DecisionLedger {
  commit(record: DecisionRecord): Promise<CommittedDecision>;
}

export class HorizonDecisionLedger implements DecisionLedger {
  private readonly server: Horizon.Server;
  private readonly signer: Keypair;

  constructor(opts: { horizonUrl: string; ledgerSecret: string }) {
    this.server = new Horizon.Server(opts.horizonUrl);
    this.signer = Keypair.fromSecret(opts.ledgerSecret);
  }

  get publicKey(): string {
    return this.signer.publicKey();
  }

  async commit(record: DecisionRecord): Promise<CommittedDecision> {
    const key = ledgerKey(record.submission, record.appealOf !== null);
    const value = ledgerValue(record);
    const hash = decisionHash(record);

    let account;
    try {
      account = await this.server.loadAccount(this.signer.publicKey());
    } catch (cause) {
      throw new AppError("LEDGER", "decision ledger account not found on network", { account: this.publicKey }, { cause });
    }

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({ name: key, value }))
      .addMemo(Memo.hash(hash))
      .setTimeout(60)
      .build();
    tx.sign(this.signer);

    try {
      const res = await this.server.submitTransaction(tx);
      log.info("decision committed", { txHash: res.hash, key });
      return { txHash: res.hash, ledgerKey: key, decisionHash: hash.toString("hex"), canonicalJson: canonicalJson(record) };
    } catch (cause) {
      const detail = extractHorizonError(cause);
      throw new AppError("LEDGER", `decision commit failed: ${detail}`, { key }, { cause });
    }
  }
}

function extractHorizonError(e: unknown): string {
  if (typeof e === "object" && e && "response" in e) {
    const r = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response;
    const codes = r?.data?.extras?.result_codes;
    if (codes) return JSON.stringify(codes);
  }
  return e instanceof Error ? e.message : "unknown";
}

/** In-memory ledger for unit tests: deterministic fake hashes, no network. */
export class FakeDecisionLedger implements DecisionLedger {
  readonly commits: Array<CommittedDecision & { record: DecisionRecord }> = [];
  async commit(record: DecisionRecord): Promise<CommittedDecision> {
    const hash = decisionHash(record).toString("hex");
    const out = {
      txHash: `fake_${hash.slice(0, 16)}`,
      ledgerKey: ledgerKey(record.submission, record.appealOf !== null),
      decisionHash: hash,
      canonicalJson: canonicalJson(record),
    };
    this.commits.push({ ...out, record });
    return out;
  }
}
