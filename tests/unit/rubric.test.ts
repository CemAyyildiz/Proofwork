import { describe, expect, it } from "vitest";
import { evaluate, validateReason, type Signals } from "@/domain/rubric";

const allPass: Signals = {
  account_genuine: true,
  content_original: true,
  task_done: true,
  follows_brief: true,
  single_account: true,
  not_spam: true,
};

describe("rubric", () => {
  it("passes at 4 of 6 and fails at 3 of 6", () => {
    expect(evaluate(allPass).outcome).toBe("PASS");
    expect(evaluate({ ...allPass, not_spam: false, single_account: false }).outcome).toBe("PASS");
    expect(evaluate({ ...allPass, not_spam: false, single_account: false, task_done: false }).outcome).toBe("FAIL");
  });

  it("requires R00_PASS for a pass and a failed-signal code for a fail", () => {
    expect(validateReason(allPass, "R00_PASS").ok).toBe(true);
    expect(validateReason(allPass, "R06_SPAM").ok).toBe(false);
    const fail: Signals = { ...allPass, content_original: false, task_done: false, not_spam: false };
    expect(validateReason(fail, "R02_ORIGINAL").ok).toBe(true);
    expect(validateReason(fail, "R01_ACCOUNT").ok).toBe(false);
    expect(validateReason(fail, "R00_PASS").ok).toBe(false);
  });
});
