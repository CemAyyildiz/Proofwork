import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, decisionHash, ledgerKey, ledgerValue, rubricVersionOf, storedLedgerValue, type DecisionRecord } from "@/ledger/canonical";

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

describe("rubric v2 record", () => {
  const v2: DecisionRecord = { ...record, v: 2, rubric: "v2" };

  it("puts the rubric right after the version and keeps every other key in place", () => {
    const json = canonicalJson(v2);
    expect(Object.keys(JSON.parse(json) as object)).toEqual(["v", "rubric", "submission", "campaign", "reviewer", "outcome", "reason", "signals", "appealOf", "decidedAt"]);
    expect(json.startsWith('{"v":2,"rubric":"v2","submission":"k7m2p9qx"')).toBe(true);
  });

  it("writes v2 on-chain and leaves the v1 hash and value as they were", () => {
    expect(ledgerValue(v2).toString("utf8").startsWith("v2|FAIL|R02_ORIGINAL|")).toBe(true);
    expect(decisionHash(v2).equals(decisionHash(record))).toBe(false);
    expect(canonicalJson(record)).not.toContain("rubric");
    expect(ledgerValue(record).toString("utf8").startsWith("v1|")).toBe(true);
  });

  it("shows a stored decision with the value its record version wrote on-chain", () => {
    for (const r of [record, v2]) {
      const stored = { canonicalJson: canonicalJson(r), outcome: r.outcome, reasonCode: r.reason, decisionHash: decisionHash(r).toString("hex") };
      expect(storedLedgerValue(stored)).toBe(ledgerValue(r).toString("utf8"));
    }
    expect(storedLedgerValue({ canonicalJson: "{}", outcome: "PASS", reasonCode: "R00_PASS", decisionHash: "ab".repeat(32) })).toBe(`v1|PASS|R00_PASS|${"ab".repeat(8)}`);
  });

  it("reads the rubric back from a stored record, and unknown text as null", () => {
    expect(rubricVersionOf(canonicalJson(record))).toBe("v1");
    expect(rubricVersionOf(canonicalJson(v2))).toBe("v2");
    expect(rubricVersionOf("{}")).toBeNull();
    expect(rubricVersionOf('{"v":2}')).toBeNull();
    expect(rubricVersionOf('{"v":1,"rubric":"v2"}')).toBeNull();
    expect(rubricVersionOf("not json")).toBeNull();
    expect(rubricVersionOf("null")).toBeNull();
  });
});
