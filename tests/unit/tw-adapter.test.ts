import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { TrustlessWorkAdapter } from "@/escrow/trustless-work/adapter";
import { TrustlessWorkClient } from "@/escrow/trustless-work/client";
import { type FakeReply, fakeFetch } from "./fake-fetch";

type Handler = (url: string, init: RequestInit) => FakeReply;

const admin = Keypair.random();
const ops = Keypair.random();
const funder = Keypair.random().publicKey();
const resolver = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();

function unsignedXdr(): string {
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: "t", value: "v" }))
    .setTimeout(0)
    .build()
    .toXDR();
}

function adapter(handler: Handler): TrustlessWorkAdapter {
  return new TrustlessWorkAdapter({
    client: new TrustlessWorkClient("https://tw.test", "k".repeat(20), fakeFetch(handler)),
    usdcIssuer: issuer,
    platformAdmin: admin,
    platformOps: ops,
  });
}

function body(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const escrowRead = {
  contractId: "C1",
  engagementId: "camp-1",
  title: "T",
  description: "D",
  balance: 10.5,
  platformFee: 0,
  roles: { approver: ops.publicKey(), serviceProvider: ops.publicKey(), platformAddress: admin.publicKey(), releaseSigner: funder, disputeResolver: resolver },
  milestones: [
    { description: "close", amount: 0.0000001, receiver: funder, status: "pending", flags: { disputed: false } },
    { description: "s1", amount: "2", receiver: "G_C1", status: "completed", evidence: "https://x.com/a/status/1", flags: { approved: true, released: true } },
  ],
  trustline: { address: issuer, symbol: "USDC" },
};

describe("TrustlessWorkAdapter (v1)", () => {
  it("throws ESCROW with the provider message when send-transaction reports FAILED", async () => {
    const a = adapter(() => ({ status: 200, body: { status: "FAILED", message: "tx_bad_seq" } }));
    await expect(a.submit(unsignedXdr())).rejects.toMatchObject({ code: "ESCROW", message: expect.stringMatching(/tx_bad_seq/) });
  });

  it("returns the locally derived hash, not anything from the body", async () => {
    const xdr = unsignedXdr();
    const a = adapter(() => ({ status: 200, body: { status: "SUCCESS", txHash: "f".repeat(64), contractId: "C9" } }));
    const res = await a.submit(xdr);
    expect(res.txHash).toBe(TransactionBuilder.fromXDR(xdr, Networks.TESTNET).hash().toString("hex"));
    expect(res.contractId).toBe("C9");
  });

  it("deploys with approver = serviceProvider = ops and the funder as sole release signer", async () => {
    let sent: Record<string, unknown> = {};
    const a = adapter((url, init) => {
      expect(url).toBe("https://tw.test/deployer/multi-release");
      sent = body(init);
      return { status: 200, body: { unsignedTransaction: "AAAA" } };
    });
    await a.buildDeploy({
      engagementId: "camp-1",
      title: "T",
      description: "D",
      signer: funder,
      roles: { funder, platformAdmin: admin.publicKey(), platformOps: ops.publicKey(), disputeResolver: resolver },
      closeMilestone: { description: "close", amount: "0.0000001" },
    });
    expect(sent["roles"]).toEqual({
      approver: ops.publicKey(),
      serviceProvider: ops.publicKey(),
      releaseSigner: funder,
      platformAddress: admin.publicKey(),
      disputeResolver: resolver,
    });
    expect(sent["milestones"]).toEqual([{ description: "close", amount: 0.0000001, receiver: funder }]);
  });

  it("appends milestones by echoing the current escrow unchanged", async () => {
    let update: Record<string, unknown> = {};
    const a = adapter((url, init) => {
      if (url.includes("/helper/get-escrow-by-contract-ids")) return { status: 200, body: [escrowRead] };
      if (url.endsWith("/escrow/multi-release/update-escrow")) {
        update = body(init);
        return { status: 200, body: { unsignedTransaction: unsignedXdr() } };
      }
      if (url.endsWith("/helper/send-transaction")) return { status: 200, body: { status: "SUCCESS" } };
      throw new Error(`unexpected ${url}`);
    });
    await a.appendMilestones("C1", [{ description: "s2", amount: "3.5", receiver: "G_C2" }]);
    const escrow = update["escrow"] as { milestones: unknown[]; roles: unknown; engagementId: string };
    expect(update["signer"]).toBe(admin.publicKey());
    expect(escrow.engagementId).toBe("camp-1");
    expect(escrow.roles).toEqual(escrowRead.roles);
    expect(escrow.milestones).toEqual([
      { description: "close", amount: 0.0000001, receiver: funder, status: "pending", flags: { disputed: false } },
      { description: "s1", amount: 2, receiver: "G_C1", status: "completed", evidence: "https://x.com/a/status/1", flags: { approved: true, released: true } },
      { description: "s2", amount: 3.5, receiver: "G_C2" },
    ]);
  });

  it("sends milestoneIndex as a string", async () => {
    let sent: Record<string, unknown> = {};
    const a = adapter((_url, init) => {
      sent = body(init);
      return { status: 200, body: { unsignedTransaction: "AAAA" } };
    });
    const [u] = await a.buildRelease("C1", funder, [1]);
    expect(sent).toEqual({ contractId: "C1", releaseSigner: funder, milestoneIndex: "1" });
    expect(u?.milestoneIndex).toBe(1);
  });

  it("maps the read into decimal-string amounts and boolean flags", async () => {
    const a = adapter(() => ({ status: 200, body: [escrowRead] }));
    const s = await a.getEscrow("C1");
    expect(s.balance).toBe("10.5");
    expect(s.roles).toEqual({ funder, platformAdmin: admin.publicKey(), platformOps: ops.publicKey(), disputeResolver: resolver });
    expect(s.milestones[0]).toMatchObject({ index: 0, amount: "0.0000001", approved: false, released: false, disputed: false, resolved: false });
    expect(s.milestones[1]).toMatchObject({ index: 1, amount: "2", status: "completed", approved: true, released: true });
  });
});
