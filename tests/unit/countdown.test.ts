import { describe, expect, it } from "vitest";
import { countdownLabel } from "@/components/countdown";

const END = Date.UTC(2026, 9, 2, 18, 0);

describe("countdownLabel", () => {
  it("counts days, hours and minutes to the UTC deadline", () => {
    expect(countdownLabel(END, END - (6 * 86_400_000 + 20 * 3_600_000 + 14 * 60_000))).toBe("6d 20h 14m");
  });

  it("drops the day part in the last day", () => {
    expect(countdownLabel(END, END - (3 * 3_600_000 + 5 * 60_000))).toBe("3h 5m");
  });

  it("reads Closed once the deadline has passed", () => {
    expect(countdownLabel(END, END)).toBe("Closed");
    expect(countdownLabel(END, END + 1)).toBe("Closed");
  });
});
