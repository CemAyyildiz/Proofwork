import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/components/hash-check";
import { EVIDENCE_TXS, SPIKE_CONTRACT, SPIKE_FUND, SPIKE_RECORD, SPIKE_RELEASE } from "@/components/landing/evidence";
import { verdictFor } from "@/components/landing/rubric-playground";
import { evaluate, SIGNALS, type Signals } from "@/domain/rubric";

const EVIDENCE = readFileSync(fileURLToPath(new URL("../../docs/evidence/escrow-cycle.md", import.meta.url)), "utf8");

describe("verify playground record", () => {
  it("hashes to the memo recorded on testnet", async () => {
    expect(createHash("sha256").update(SPIKE_RECORD.canonicalJson, "utf8").digest("hex")).toBe(SPIKE_RECORD.memoHash);
    // The same WebCrypto path the browser runs.
    expect(await sha256Hex(SPIKE_RECORD.canonicalJson)).toBe("6a72919fdfbd4426a88b50a293779bede72201987328912e593acbffd721220f");
  });

  it("is the canonical JSON and decision tx in docs/evidence/escrow-cycle.md", () => {
    expect(EVIDENCE).toContain(SPIKE_RECORD.canonicalJson);
    expect(EVIDENCE).toContain(`tx/${SPIKE_RECORD.txHash}`);
    expect(EVIDENCE).toContain(`key=${SPIKE_RECORD.ledgerKey}`);
    expect(EVIDENCE).toContain(SPIKE_CONTRACT);
  });

  it("uses only transaction hashes from the evidence file", () => {
    for (const tx of [...EVIDENCE_TXS.map((t) => t.hash), SPIKE_FUND.txHash, SPIKE_RELEASE.txHash]) {
      expect(tx).toMatch(/^[0-9a-f]{64}$/);
      expect(EVIDENCE).toContain(`tx/${tx}`);
    }
  });
});

function withPasses(n: number): Signals {
  return Object.fromEntries(SIGNALS.map((s, i) => [s.id, i < n])) as Signals;
}

describe("rubric playground", () => {
  it("fails at 3 of 6, exactly as evaluate() does", () => {
    const s = withPasses(3);
    const v = verdictFor(s);
    expect(evaluate(s).outcome).toBe("FAIL");
    expect(v.outcome).toBe(evaluate(s).outcome);
    expect(v.passCount).toBe(3);
    expect(v.reason).toBe(SIGNALS[3].failCode);
  });

  it("passes at 4 of 6, exactly as evaluate() does", () => {
    const s = withPasses(4);
    const v = verdictFor(s);
    expect(evaluate(s).outcome).toBe("PASS");
    expect(v.outcome).toBe(evaluate(s).outcome);
    expect(v.passCount).toBe(4);
    expect(v.reason).toBe("R00_PASS");
  });
});
