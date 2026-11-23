import { Account, BadResponseError, Horizon, Keypair, Networks, NotFoundError, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { decisionHash, ledgerValue, type DecisionRecord } from "@/ledger/canonical";
import {
  DECISION_FEE_STROOPS,
  DECISION_TX_TIMEOUT_S,
  DecisionPendingError,
  DecisionRejectedError,
  HorizonDecisionLedger,
} from "@/ledger/decision-ledger";

const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };

const record: DecisionRecord = {
  v: 2,
  rubric: "v2",
  submission: "abc123",
  campaign: "camp-1",
  reviewer: "GREVIEWER",
  outcome: "PASS",
  reason: "R00_PASS",
  signals: ALL_PASS,
  appealOf: null,
  decidedAt: "2026-11-23T10:00:00.000Z",
};

/** The parts of Horizon.Server the ledger calls, answering from memory. */
class StubHorizon {
  readonly submitted: Transaction[] = [];
  loadAccountError: unknown = null;
  submitError: unknown = null;
  lookup: (hash: string) => Promise<{ successful: boolean }> = async () => {
    throw new NotFoundError("Not Found", { status: 404 });
  };
  private seq = 100n;

  async loadAccount(id: string): Promise<Account> {
    if (this.loadAccountError) throw this.loadAccountError;
    return new Account(id, String(this.seq));
  }

  async submitTransaction(tx: Transaction): Promise<{ hash: string }> {
    this.submitted.push(tx);
    if (this.submitError) throw this.submitError;
    return { hash: tx.hash().toString("hex") };
  }

  transactions() {
    return { transaction: (hash: string) => ({ call: () => this.lookup(hash) }) };
  }
}

let horizon: StubHorizon;
let ledger: HorizonDecisionLedger;
const secret = Keypair.random().secret();

beforeEach(() => {
  horizon = new StubHorizon();
  ledger = new HorizonDecisionLedger({
    horizonUrl: "https://horizon.invalid",
    ledgerSecret: secret,
    networkPassphrase: Networks.TESTNET,
    server: horizon as unknown as Horizon.Server,
  });
});

/** An HTTP client error as the SDK passes it through: the body under `response.data`. */
function httpError(status: number, data: unknown): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
}
const rejectedBody = (tx: string, ops: string[] = []) => ({ status: 400, title: "Transaction Failed", extras: { result_codes: { transaction: tx, operations: ops } } });

describe("the decision transaction", () => {
  it("carries memo hash = decisionHash(record), one manage_data pw:<id> with the v2 value, and the fee policy", async () => {
    const before = Math.floor(Date.now() / 1000);
    const signed = await ledger.sign(record);
    await ledger.submit(signed);

    expect(horizon.submitted).toHaveLength(1);
    const tx = horizon.submitted[0] as Transaction;
    expect(tx.hash().toString("hex")).toBe(signed.txHash);
    expect(tx.toEnvelope().toXDR("base64")).toBe(signed.envelopeXdr);
    expect(tx.memo.type).toBe("hash");
    expect(Buffer.from(tx.memo.value as Buffer).equals(decisionHash(record))).toBe(true);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0];
    expect(op).toMatchObject({ type: "manageData", name: "pw:abc123" });
    const value = op?.type === "manageData" ? op.value : undefined;
    expect(value?.toString("utf8")).toBe(ledgerValue(record).toString("utf8"));
    expect(value?.toString("utf8")).toMatch(/^v2\|PASS\|R00_PASS\|[0-9a-f]{16}$/);
    expect(tx.fee).toBe(DECISION_FEE_STROOPS);
    expect(tx.source).toBe(ledger.publicKey);
    const maxTime = Number(tx.timeBounds?.maxTime);
    expect(maxTime).toBeGreaterThanOrEqual(before + DECISION_TX_TIMEOUT_S);
    expect(maxTime).toBeLessThanOrEqual(before + DECISION_TX_TIMEOUT_S + 5);
    expect(signed.expiresAt.getTime()).toBe(maxTime * 1000);
  });

  it("keys a re-review pw:<id>:a1", async () => {
    const signed = await ledger.sign({ ...record, appealOf: "ab".repeat(32), outcome: "FAIL", reason: "R06_SPAM", signals: { ...ALL_PASS, not_spam: false, task_done: false, content_original: false } });
    const tx = TransactionBuilder.fromXDR(signed.envelopeXdr, Networks.TESTNET) as Transaction;
    expect(tx.operations[0]).toMatchObject({ type: "manageData", name: "pw:abc123:a1" });
  });

  it("signing sends nothing, and the same envelope is what gets sent", async () => {
    const signed = await ledger.sign(record);
    expect(horizon.submitted).toEqual([]);
    await ledger.submit(signed);
    await ledger.submit(signed);
    expect(horizon.submitted.map((t) => t.hash().toString("hex"))).toEqual([signed.txHash, signed.txHash]);
  });
});

describe("loading the ledger account", () => {
  it("says the account is missing only on a 404", async () => {
    horizon.loadAccountError = new NotFoundError("Not Found", { status: 404 });
    await expect(ledger.sign(record)).rejects.toMatchObject({ code: "LEDGER", message: "decision ledger account not found on network" });
  });

  it("reports any other failure as a failed load, not a missing account", async () => {
    horizon.loadAccountError = httpError(503, { status: 503, title: "Service Unavailable" });
    await expect(ledger.sign(record)).rejects.toMatchObject({ code: "LEDGER", message: expect.stringContaining("could not load the decision ledger account") });
  });
});

describe("classifying a failed submission", () => {
  it.each([
    ["tx_bad_seq as an HTTP client error", httpError(400, rejectedBody("tx_bad_seq"))],
    ["tx_insufficient_fee as an HTTP client error", httpError(400, rejectedBody("tx_insufficient_fee"))],
    ["tx_bad_auth as BadResponseError", new BadResponseError("Transaction submission failed", rejectedBody("tx_bad_auth"))],
    ["an operation error", httpError(400, rejectedBody("tx_failed", ["op_low_reserve"]))],
  ])("%s is a definitive rejection", async (_name, error) => {
    const signed = await ledger.sign(record);
    horizon.submitError = error;
    await expect(ledger.submit(signed)).rejects.toBeInstanceOf(DecisionRejectedError);
  });

  it.each([
    ["a 504 timeout", httpError(504, { status: 504, title: "Timeout" })],
    ["a 503", httpError(503, { status: 503, title: "Service Unavailable" })],
    ["a lost connection", new Error("socket hang up")],
    ["a 400 without result codes", httpError(400, { status: 400, title: "Bad Request" })],
  ])("%s leaves the outcome unknown", async (_name, error) => {
    const signed = await ledger.sign(record);
    horizon.submitError = error;
    await expect(ledger.submit(signed)).rejects.toBeInstanceOf(DecisionPendingError);
  });
});

describe("looking a transaction up", () => {
  it("not found, successful, failed", async () => {
    expect(await ledger.status("aa")).toBe("not_found");
    horizon.lookup = async () => ({ successful: true });
    expect(await ledger.status("aa")).toBe("success");
    horizon.lookup = async () => ({ successful: false });
    expect(await ledger.status("aa")).toBe("failed");
  });

  it("a lookup Horizon cannot answer is pending, never not-found", async () => {
    horizon.lookup = async () => {
      throw httpError(503, { status: 503 });
    };
    await expect(ledger.status("aa")).rejects.toBeInstanceOf(DecisionPendingError);
  });
});
