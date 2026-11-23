import { Account, Address, Keypair, Networks, Operation, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
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
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 2));
const DEPLOYER = StrKey.encodeContract(Buffer.alloc(32, 3));

function unsignedXdr(): string {
  return unsignedFrom(Keypair.random().publicKey());
}

/** A classic manage_data envelope from `source`. */
function unsignedFrom(source: string): string {
  return new TransactionBuilder(new Account(source, "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: "t", value: "v" }))
    .setTimeout(0)
    .build()
    .toXDR();
}

/** The envelope Trustless Work builds for a contract call: one invokeHostFunction from `source`, with a footprint. */
function contractCall(
  source: string,
  contract: string,
  o: { fee?: string; extraOp?: boolean; opSource?: string; readWrite?: string[] } = {},
): string {
  const instance = (id: string) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(id).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
  const b = new TransactionBuilder(new Account(source, "0"), { fee: o.fee ?? "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract, function: "call", args: [], ...(o.opSource ? { source: o.opSource } : {}) }))
    .setSorobanData(new SorobanDataBuilder().setFootprint([instance(contract)], (o.readWrite ?? []).map(instance)).build())
    .setTimeout(0);
  if (o.extraOp) b.addOperation(Operation.manageData({ name: "t", value: "v" }));
  return b.build().toXDR();
}

function adapter(handler: Handler): TrustlessWorkAdapter {
  return new TrustlessWorkAdapter({
    client: new TrustlessWorkClient("https://tw.test", "k".repeat(20), fakeFetch(handler)),
    usdcIssuer: issuer,
    platformAdmin: admin,
    platformOps: ops,
    networkPassphrase: Networks.TESTNET,
  });
}


function body(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const escrowRead = {
  contractId: CONTRACT,
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
      return { status: 200, body: { unsignedTransaction: contractCall(funder, DEPLOYER, { readWrite: [CONTRACT] }) } };
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
        return { status: 200, body: { unsignedTransaction: contractCall(admin.publicKey(), CONTRACT) } };
      }
      if (url.endsWith("/helper/send-transaction")) return { status: 200, body: { status: "SUCCESS" } };
      throw new Error(`unexpected ${url}`);
    });
    await a.appendMilestones(CONTRACT, [{ description: "s2", amount: "3.5", receiver: "G_C2" }]);
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
    const s = await a.getEscrow(CONTRACT);
    expect(s.balance).toBe("10.5");
    expect(s.roles).toEqual({
      funder,
      releaseSigner: funder,
      approver: ops.publicKey(),
      platformAdmin: admin.publicKey(),
      platformOps: ops.publicKey(),
      disputeResolver: resolver,
    });
    expect(s.milestones[0]).toMatchObject({ index: 0, amount: "0.0000001", approved: false, released: false, disputed: false, resolved: false });
    expect(s.milestones[1]).toMatchObject({ index: 1, amount: "2", status: "completed", approved: true, released: true });
  });


});

describe("server keys never sign a provider transaction blindly", () => {
  /** A provider that answers every build with `envelope` and fails the test if anything is sent. */
  const building = (envelope: string): Handler => (url) => {
    if (url.includes("/helper/get-escrow-by-contract-ids")) return { status: 200, body: [escrowRead] };
    if (url.endsWith("/helper/send-transaction")) throw new Error("a refused transaction was sent");
    return { status: 200, body: { unsignedTransaction: envelope } };
  };

  const cases: Array<[string, (signer: string) => string, RegExp]> = [
    ["another source account", () => contractCall(Keypair.random().publicKey(), CONTRACT), /source account is not the signing key/],
    ["a second operation", (signer) => contractCall(signer, CONTRACT, { extraOp: true }), /exactly one operation/],
    ["a classic operation", (signer) => unsignedFrom(signer), /operation is manageData, not a contract call/],
    ["a call to another contract", (signer) => contractCall(signer, OTHER_CONTRACT), /calls another contract/],
    ["an operation with another source", (signer) => contractCall(signer, CONTRACT, { opSource: Keypair.random().publicKey() }), /operation source/],
    ["a fee over the cap", (signer) => contractCall(signer, CONTRACT, { fee: "100000001" }), /over the cap/],
  ];

  it.each(cases)("append refuses %s", async (_name, envelope, message) => {
    await expect(adapter(building(envelope(admin.publicKey()))).appendMilestones(CONTRACT, [{ description: "s2", amount: "1", receiver: "G_C2" }])).rejects.toMatchObject({
      code: "ESCROW",
      message: expect.stringMatching(message),
    });
  });

  it.each(cases)("mark delivered refuses %s", async (_name, envelope, message) => {
    await expect(adapter(building(envelope(ops.publicKey()))).markDelivered(CONTRACT, [{ index: 1, evidence: "https://x.com/a/status/1" }])).rejects.toMatchObject({
      code: "ESCROW",
      message: expect.stringMatching(message),
    });
  });

  it.each(cases)("approve refuses %s", async (_name, envelope, message) => {
    await expect(adapter(building(envelope(ops.publicKey()))).approveMilestones(CONTRACT, [1])).rejects.toMatchObject({
      code: "ESCROW",
      message: expect.stringMatching(message),
    });
  });

  it("the admin key does not sign what is built for the ops key", async () => {
    await expect(adapter(building(contractCall(ops.publicKey(), CONTRACT))).appendMilestones(CONTRACT, [{ description: "s2", amount: "1", receiver: "G_C2" }])).rejects.toMatchObject({
      message: expect.stringMatching(/source account is not the signing key/),
    });
  });

  it("signs and sends one call on this escrow from its own key", async () => {
    let sent = 0;
    const a = adapter((url) => {
      if (url.endsWith("/helper/send-transaction")) {
        sent += 1;
        return { status: 200, body: { status: "SUCCESS" } };
      }
      return { status: 200, body: { unsignedTransaction: contractCall(ops.publicKey(), CONTRACT) } };
    });
    await expect(a.approveMilestones(CONTRACT, [1])).resolves.toHaveLength(1);
    expect(sent).toBe(1);
  });
});
