import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, decisionHash, ledgerKey, ledgerValue, type DecisionRecord } from "@/ledger/canonical";

const record: DecisionRecord = {
  v: 1,
  submission: "k7m2p9qx",
  campaign: "launch-feedback",
  reviewer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  outcome: "FAIL",
  reason: "R02_ORIGINAL",
  signals: {
    not_spam: true,
    account_genuine: true,
    single_account: true,
    content_original: false,
    follows_brief: true,
    task_done: false,
  },
  appealOf: null,
  decidedAt: "2026-09-23T12:00:00.000Z",
};

describe("canonical decision record", () => {
  it("serialises with fixed key order regardless of input order", () => {
    const json = canonicalJson(record);
    expect(json.startsWith('{"v":1,"submission":"k7m2p9qx","campaign":"launch-feedback"')).toBe(true);
    expect(json).toContain(
      '"signals":{"account_genuine":true,"content_original":false,"task_done":false,"follows_brief":true,"single_account":true,"not_spam":true}',
    );
  });

  it("hash equals sha256 of the canonical json", () => {
    const expected = createHash("sha256").update(canonicalJson(record)).digest("hex");
    expect(decisionHash(record).toString("hex")).toBe(expected);
  });

  it("ledger key and value fit manage_data limits", () => {
    expect(ledgerKey("k7m2p9qx", false)).toBe("pw:k7m2p9qx");
    expect(ledgerKey("k7m2p9qx", true)).toBe("pw:k7m2p9qx:a1");
    const v = ledgerValue(record);
    expect(v.byteLength).toBeLessThanOrEqual(64);
    expect(v.toString("utf8").startsWith("v1|FAIL|R02_ORIGINAL|")).toBe(true);
  });
});
