import { describe, expect, it } from "vitest";
import { canonicalizeSubmissionUrl, postIdSchema, submissionUrlSchema } from "@/domain/submission-url";

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

  it("gives one post ID for one post, whatever handle, host or tail the link carries", () => {
    const ids = [
      "https://x.com/alice/status/999",
      "https://x.com/ALICE_/status/999",
      "https://twitter.com/bob/status/999",
      "https://x.com/alice/status/999?s=20&t=abc",
      "https://x.com/alice/status/999/photo/1",
      "https://x.com/alice/status/999#m",
    ].map((url) => canonicalizeSubmissionUrl(url).statusId);
    expect(new Set(ids)).toEqual(new Set(["999"]));
  });

  it("takes a post ID of up to 19 digits, as X does", () => {
    const longest = "9".repeat(19);
    expect(canonicalizeSubmissionUrl(`https://x.com/alice/status/${longest}`).statusId).toBe(longest);
    expect(submissionUrlSchema.safeParse(`https://x.com/alice/status/1${"0".repeat(19)}`).success).toBe(false);
    expect(submissionUrlSchema.safeParse(`https://x.com/alice/status/${"9".repeat(20)}?s=20`).success).toBe(false);
  });

  it("refuses a second spelling of the same post ID", () => {
    for (const bad of ["https://x.com/alice/status/0999", "https://x.com/alice/status/0", "https://twitter.com/alice/status/00"]) {
      expect(submissionUrlSchema.safeParse(bad).success, bad).toBe(false);
      expect(() => canonicalizeSubmissionUrl(bad)).toThrow();
    }
  });

  it("checks a bare post ID by the same rule", () => {
    for (const ok of ["1", "999", "9".repeat(19)]) expect(postIdSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["", "0", "0999", "9".repeat(20), "12a", " 12", "12\n"]) expect(postIdSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
