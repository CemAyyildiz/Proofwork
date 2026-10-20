import { describe, expect, it } from "vitest";
import { formatDateShort, formatRelative, formatTimestamp, shortKey, truncateMiddle } from "@/lib/format";

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

describe("formatDateShort", () => {
  it("reads as day, month and UTC time", () => {
    expect(formatDateShort(new Date("2026-10-02T18:00:00Z"))).toBe("2 Oct · 18:00 UTC");
    expect(formatDateShort(new Date("2026-09-23T00:05:00Z"))).toBe("23 Sep · 00:05 UTC");
  });
});

describe("formatTimestamp", () => {
  it("reads as a UTC date and time to the second", () => {
    expect(formatTimestamp(new Date("2026-10-13T09:31:07.159Z"))).toBe("2026-10-13 09:31:07 UTC");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms);
  const H = 3_600_000;
  const D = 24 * H;

  it("says how far ahead a date is", () => {
    expect(formatRelative(at(6 * D + 4 * H), now)).toBe("in 6d 4h");
    expect(formatRelative(at(3 * H + 59 * 60_000), now)).toBe("in 3h");
    expect(formatRelative(at(25 * 60_000), now)).toBe("in 25m");
  });

  it("says how long ago a date was, days only past a week", () => {
    expect(formatRelative(at(-(8 * D + 15 * H)), now)).toBe("8d ago");
    expect(formatRelative(at(-(2 * D)), now)).toBe("2d ago");
  });

  it("says just now inside the last minute, and in <1m inside the next", () => {
    expect(formatRelative(at(-30_000), now)).toBe("just now");
    expect(formatRelative(now, now)).toBe("just now");
    expect(formatRelative(at(30_000), now)).toBe("in <1m");
  });
});
