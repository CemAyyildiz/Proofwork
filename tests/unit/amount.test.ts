import { describe, expect, it } from "vitest";
import { addAmounts, assertPositiveAmount, fromApiAmount, fromStroops, subAmounts, toApiAmount, toStroops } from "@/escrow/amount";

describe("amount", () => {
  it("round-trips decimal strings through stroops without float error", () => {
    expect(toStroops("10")).toBe(100_000_000n);
    expect(toStroops("0.1")).toBe(1_000_000n);
    expect(fromStroops(toStroops("123.4567891"))).toBe("123.4567891");
    expect(addAmounts("0.1", "0.2")).toBe("0.3");
    expect(subAmounts("10", "2.5")).toBe("7.5");
  });

  it("rejects malformed and non-positive amounts", () => {
    expect(() => toStroops("1e5")).toThrow();
    expect(() => toStroops("-1")).toThrow();
    expect(toStroops("0")).toBe(0n);
    expect(() => assertPositiveAmount("0")).toThrow();
    expect(() => toApiAmount("0.0")).toThrow();
    expect(() => toStroops("1.12345678")).toThrow();
    expect(() => subAmounts("1", "2")).toThrow();
  });

  it("converts to and from the provider number type exactly", () => {
    expect(toApiAmount("10.5")).toBe(10.5);
    expect(fromApiAmount(10.5)).toBe("10.5");
    expect(fromApiAmount(0)).toBe("0");
  });
});
