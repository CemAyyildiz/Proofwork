import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sealFor } from "@/components/hash-check";
import { submissionUrlSchema } from "@/domain/submission-url";
import { budgetMeter } from "@/lib/format";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { SubmitForm } = await import("@/components/submit-form");

const HASH = "6a72919fdfbd4426a88b50a293779bede72201987328912e593acbffd721220f";

describe("budget meter", () => {
  it("reads 95 of 100 USDC left at 95%", () => {
    expect(budgetMeter("95", "100")).toEqual({ pct: 95, label: "95 of 100 USDC left" });
  });

  it("shows no meter when the balance read failed", () => {
    expect(budgetMeter(null, "100")).toBeNull();
  });

  it("clamps to 0–100 and shows no meter for a zero budget", () => {
    expect(budgetMeter("120", "100")?.pct).toBe(100);
    expect(budgetMeter("0", "100")?.pct).toBe(0);
    expect(budgetMeter("5", "0")).toBeNull();
  });
});

describe("verify seal", () => {
  it("is pending until the browser has a hash", () => {
    expect(sealFor(null, HASH, "tx")).toBeNull();
  });

  it("fails red when the recomputed hash differs", () => {
    expect(sealFor(`${HASH.slice(0, -1)}0`, HASH, "tx")).toEqual({ tone: "fail", title: "Does not match the recorded hash" });
  });

  it("names the on-chain memo only when there is a transaction", () => {
    expect(sealFor(HASH, HASH, "tx")?.title).toBe("Hash matches the on-chain memo");
    expect(sealFor(HASH, HASH, null)?.title).toBe("Matches the recorded hash");
  });
});

describe("submit form", () => {
  it("starts with Submit disabled until the field holds an X status link", () => {
    const html = renderToStaticMarkup(createElement(SubmitForm, { campaignSlug: "c", payTo: "GDXGQ7VJ2Y6XJ3KZ5L4M8N2P7R9S3T6U1W4X8Y2Z5A7B9C3D6EQR4F2A" }));
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*\bdisabled=""/);
  });

  it("gates on the same schema the server enforces", () => {
    expect(submissionUrlSchema.safeParse("https://example.com/post").success).toBe(false);
    expect(submissionUrlSchema.safeParse("https://x.com/deniz_k/status/1841200000000000000").success).toBe(true);
  });
});
