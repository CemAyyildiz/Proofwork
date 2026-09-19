import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { jsonRoute } from "@/lib/http";
import { createCampaignSchema } from "@/services/campaign";

const base = {
  title: "Campaign",
  brief: "A brief long enough to pass validation.",
  rewardAmount: "10",
  deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
  disputeResolverPubkey: Keypair.random().publicKey(),
};

describe("createCampaignSchema reward cap", () => {
  it.each([
    ["490", true],
    ["499.9999999", true],
    ["500", false],
    ["10", true],
  ])("budget %s at reward 10 accepted: %s", (budget, ok) => {
    expect(createCampaignSchema.safeParse({ ...base, budget }).success).toBe(ok);
  });

  it("floor(budget / reward) = 50 fails on budget with the cap message", () => {
    const res = createCampaignSchema.safeParse({ ...base, rewardAmount: "0.1", budget: "5" });
    expect(res.success).toBe(false);
    expect(res.error?.issues).toEqual([
      expect.objectContaining({ path: ["budget"], message: "budget covers more than 49 rewards; the escrow holds 49 reward milestones" }),
    ]);
  });

  it("floor(budget / reward) = 49 is accepted", () => {
    expect(createCampaignSchema.safeParse({ ...base, rewardAmount: "0.1", budget: "4.9999999" }).success).toBe(true);
  });

  it("a route on the schema answers VALIDATION 400", async () => {
    const route = jsonRoute(createCampaignSchema, async () => ({ ok: true }));
    const res = await route(new Request("http://test/api/campaigns", { method: "POST", body: JSON.stringify({ ...base, budget: "500" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION", details: { issues: [{ path: ["budget"] }] } });
  });
});
