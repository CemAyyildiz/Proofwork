import { describe, expect, it } from "vitest";
import { canonicalizeSubmissionUrl, submissionUrlSchema } from "@/domain/submission-url";

describe("submission url", () => {
  it("accepts x.com and twitter.com status urls and canonicalises them", () => {
    expect(submissionUrlSchema.safeParse("https://x.com/alice/status/1234567890").success).toBe(true);
    expect(canonicalizeSubmissionUrl("https://twitter.com/alice/status/1234567890?s=20").url).toBe("https://x.com/alice/status/1234567890");
    expect(canonicalizeSubmissionUrl(" https://x.com/Alice_1/status/99/ ").handle).toBe("Alice_1");
  });

  it("rejects anything else", () => {
    for (const bad of [
      "http://x.com/alice/status/1",
      "https://x.com/alice",
      "https://x.com/alice/status/abc",
      "https://evil.com/x.com/alice/status/1",
      "https://x.com.evil.com/alice/status/1",
      "javascript:alert(1)",
      "https://x.com/this_handle_is_way_too_long/status/1",
    ]) {
      expect(submissionUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
