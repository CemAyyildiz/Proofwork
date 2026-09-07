import { describe, expect, it } from "vitest";
import { FakeEscrow } from "@/escrow/fake";
import type { EscrowRoles } from "@/escrow/port";

const roles: EscrowRoles = {
  funder: "G_FUNDER",
  platformAdmin: "G_ADMIN",
  platformOps: "G_OPS",
  disputeResolver: "G_DR",
  platformFeeAddress: "G_ADMIN",
};

describe("FakeEscrow models the campaign lifecycle", () => {
  it("deploy → fund → append → deliver → approve → release → sweep remainder", async () => {
    const e = new FakeEscrow();
    const d = await e.buildDeploy({ engagementId: "c1", title: "t", description: "d", roles, signer: roles.funder });
    await e.submit(d.unsignedXdr);
    const contractId = d.contractId as string;

    await e.submit((await e.buildFund(contractId, roles.funder, "100")).unsignedXdr);
    expect((await e.getEscrow(contractId)).balance).toBe("100");

    await e.appendMilestones(contractId, [
      { description: "s1", amount: "10", receiver: "G_C1" },
      { description: "s2", amount: "10", receiver: "G_C2" },
    ]);
    await e.markDelivered(contractId, [
      { index: 0, evidence: "https://x.com/a/status/1" },
      { index: 1, evidence: "https://x.com/b/status/2" },
    ]);

    await expect(e.submit((await e.buildRelease(contractId, roles.funder, [0])).unsignedXdr)).rejects.toThrow(
      /not releasable/,
    );

    await e.submit((await e.buildApprove(contractId, roles.funder, [0, 1])).unsignedXdr);
    await e.submit((await e.buildRelease(contractId, roles.funder, [0, 1])).unsignedXdr);
    expect((await e.getEscrow(contractId)).balance).toBe("80");

    await expect(
      e.submit((await e.buildWithdrawRemaining(contractId, roles.disputeResolver, [{ address: roles.funder, amount: "50" }])).unsignedXdr),
    ).rejects.toThrow(/entire balance/);

    await e.submit(
      (await e.buildWithdrawRemaining(contractId, roles.disputeResolver, [{ address: roles.funder, amount: "80" }])).unsignedXdr,
    );
    expect((await e.getEscrow(contractId)).balance).toBe("0");
  });

  it("refuses receivers that hold admin or disputeResolver roles", async () => {
    const e = new FakeEscrow();
    const d = await e.buildDeploy({ engagementId: "c1", title: "t", description: "d", roles, signer: roles.funder });
    await e.submit(d.unsignedXdr);
    await expect(
      e.appendMilestones(d.contractId as string, [{ description: "x", amount: "1", receiver: roles.disputeResolver }]),
    ).rejects.toThrow(/receiver cannot/);
  });
});
