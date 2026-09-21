import { describe, expect, it } from "vitest";
import { shortKey, truncateMiddle } from "@/lib/format";

const TX = "31c9dd0a7e5b4c2f8d1e6a3b9c0f4e7d2a5b8c1e4f7a0d3b6c9e2f5a815dcff4";
const WALLET = "GDXGQ7VJ2Y6XJ3KZ5L4M8N2P7R9S3T6U1W4X8Y2Z5A7B9C3D6EQR4F2A";

describe("truncateMiddle", () => {
  it("shortens a tx hash to 6 + 6", () => {
    expect(TX).toHaveLength(64);
    expect(truncateMiddle(TX, 6, 6)).toBe("31c9dd…5dcff4");
  });

  it("shortens a wallet address to 4 + 4", () => {
    expect(WALLET).toHaveLength(56);
    expect(truncateMiddle(WALLET, 4, 4)).toBe("GDXG…4F2A");
  });

  it("returns a value of at most head + tail + 1 characters unchanged", () => {
    expect(truncateMiddle("abcdefghi", 4, 4)).toBe("abcdefghi");
    expect(truncateMiddle("abcd", 4, 4)).toBe("abcd");
    expect(truncateMiddle("", 6, 6)).toBe("");
  });

  it("truncates as soon as the value is longer than head + tail + 1", () => {
    expect(truncateMiddle("abcdefghij", 4, 4)).toBe("abcd…ghij");
  });

  it("handles a zero tail", () => {
    expect(truncateMiddle("abcdefghij", 4, 0)).toBe("abcd…");
  });
});

describe("shortKey", () => {
  it("matches truncateMiddle with 4 + 4", () => {
    expect(shortKey(WALLET)).toBe(truncateMiddle(WALLET, 4, 4));
    expect(shortKey(WALLET)).toBe("GDXG…4F2A");
  });
});
