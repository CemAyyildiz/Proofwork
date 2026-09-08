import { describe, expect, it } from "vitest";
import { FakeEscrow } from "@/escrow/fake";
import type { EscrowRoles } from "@/escrow/port";

const roles: EscrowRoles = {
  funder: "G_FUNDER",
  platformAdmin: "G_ADMIN",
  platformOps: "G_OPS",
  disputeResolver: "G_DR",
};

async function deployed(e: FakeEscrow): Promise<string> {
  const d = await e.buildDeploy({
    engagementId: "c1",
    title: "t",
    description: "d",
    roles,
    signer: roles.funder,
    closeMilestone: { description: "close", amount: "0.0000001" },
  });
  const r = await e.submit(d.unsignedXdr);
  return r.contractId as string;
}

describe("FakeEscrow models the v1 campaign lifecycle", () => {
  it("deploy → fund → append → deliver → approve → release → dispute close → sweep", async () => {
    const e = new FakeEscrow();
    const contractId = await deployed(e);

    await e.submit((await e.buildFund(contractId, roles.funder, "100")).unsignedXdr);
    expect((await e.getEscrow(contractId)).balance).toBe("100");

    await e.appendMilestones(contractId, [
      { description: "s1", amount: "10", receiver: "G_C1" },
      { description: "s2", amount: "10", receiver: "G_C2" },
    ]);
    await e.markDelivered(contractId, [
      { index: 1, evidence: "https://x.com/a/status/1" },
      { index: 2, evidence: "https://x.com/b/status/2" },
    ]);

    const early = await e.buildRelease(contractId, roles.funder, [1]);
    await expect(e.submit(early[0]!.unsignedXdr)).rejects.toThrow(/not releasable/);

    for (const u of await e.buildApprove(contractId, roles.funder, [1, 2])) await e.submit(u.unsignedXdr);
    for (const u of await e.buildRelease(contractId, roles.funder, [1, 2])) await e.submit(u.unsignedXdr);
    expect((await e.getEscrow(contractId)).balance).toBe("80");

    const tooEarly = await e.buildWithdrawRemaining(contractId, roles.disputeResolver, [{ address: roles.funder, amount: "80" }]);
    await expect(e.submit(tooEarly.unsignedXdr)).rejects.toThrow(/fully processed/);

    for (const u of await e.buildDispute(contractId, roles.funder, [0])) await e.submit(u.unsignedXdr);
    const sweep = await e.buildWithdrawRemaining(contractId, roles.disputeResolver, [{ address: roles.funder, amount: "80" }]);
    await e.submit(sweep.unsignedXdr);
    expect((await e.getEscrow(contractId)).balance).toBe("0");
  });

  it("refuses a receiver that is the dispute resolver and a resolver raising a dispute", async () => {
    const e = new FakeEscrow();
    const contractId = await deployed(e);
    await expect(e.appendMilestones(contractId, [{ description: "x", amount: "1", receiver: roles.disputeResolver }])).rejects.toThrow(
      /dispute resolver/,
    );
    const d = await e.buildDispute(contractId, roles.disputeResolver, [0]);
    await expect(e.submit(d[0]!.unsignedXdr)).rejects.toThrow(/cannot raise/);
  });
});
