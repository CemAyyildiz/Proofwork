import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import type {
  DeployInput,
  EscrowPort,
  EscrowState,
  MilestoneInput,
  Submitted,
  Unsigned,
} from "../port";
import { fromApiAmount, toApiAmount } from "../amount";
import { TrustlessWorkClient, type TwEscrowRead, type TwRoles } from "./client";

export interface TrustlessWorkAdapterOptions {
  client: TrustlessWorkClient;
  usdcIssuer: string;
  /** escrow role `admin` — appends milestones */
  platformAdmin: Keypair;
  /** escrow role `serviceProvider` — marks milestones delivered */
  platformOps: Keypair;
  networkPassphrase?: string;
}

/**
 * Trustless Work v2 multi-release implementation of EscrowPort (AD-1, AD-2).
 * Server keys sign only the two operations that move no money.
 */
export class TrustlessWorkAdapter implements EscrowPort {
  private readonly client: TrustlessWorkClient;
  private readonly usdcIssuer: string;
  private readonly admin: Keypair;
  private readonly ops: Keypair;
  private readonly passphrase: string;

  constructor(o: TrustlessWorkAdapterOptions) {
    this.client = o.client;
    this.usdcIssuer = o.usdcIssuer;
    this.admin = o.platformAdmin;
    this.ops = o.platformOps;
    this.passphrase = o.networkPassphrase ?? Networks.TESTNET;
  }

  async buildDeploy(input: DeployInput): Promise<Unsigned> {
    const r = input.roles;
    if (r.platformAdmin !== this.admin.publicKey() || r.platformOps !== this.ops.publicKey()) {
      throw new AppError("ESCROW", "deploy roles do not match the configured platform keys");
    }
    const roles: TwRoles = {
      approvers: [r.funder],
      releaseSigners: [r.funder],
      serviceProviders: [r.platformOps],
      disputeResolvers: [r.disputeResolver],
      platform: r.platformFeeAddress,
      admin: r.platformAdmin,
    };
    assertRoleSeparation(roles);
    const res = await this.client.deploy({
      signer: input.signer,
      engagementId: input.engagementId,
      title: input.title,
      description: input.description,
      roles,
      platformFee: 0,
      trustline: { symbol: "USDC", address: this.usdcIssuer },
      milestones: [],
    });
    return res.contractId ? { unsignedXdr: res.unsignedXdr, contractId: res.contractId } : { unsignedXdr: res.unsignedXdr };
  }

  async buildFund(contractId: string, signer: string, amount: string): Promise<Unsigned> {
    const res = await this.client.fund({ contractId, signer, amount: toApiAmount(amount) });
    return { unsignedXdr: res.unsignedXdr };
  }

  async buildApprove(contractId: string, approver: string, milestoneIndexes: number[]): Promise<Unsigned> {
    const res = await this.client.approveMilestones({ contractId, approver, milestoneIndexes });
    return { unsignedXdr: res.unsignedXdr };
  }

  async buildRelease(contractId: string, releaseSigner: string, milestoneIndexes: number[]): Promise<Unsigned> {
    const res = await this.client.releaseFunds({ contractId, releaseSigner, milestoneIndexes });
    return { unsignedXdr: res.unsignedXdr };
  }

  async buildDispute(contractId: string, signer: string, milestoneIndexes: number[], reason: string): Promise<Unsigned> {
    const res = await this.client.disputeMilestones({ contractId, signer, milestoneIndexes, reason: reason.slice(0, 500) });
    return { unsignedXdr: res.unsignedXdr };
  }

  async buildResolve(
    contractId: string,
    disputeResolver: string,
    milestoneIndexes: number[],
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    const res = await this.client.resolveDispute({
      contractId,
      disputeResolver,
      milestoneIndexes,
      distributions: distributions.map((d) => ({ address: d.address, amount: toApiAmount(d.amount) })),
    });
    return { unsignedXdr: res.unsignedXdr };
  }

  async buildWithdrawRemaining(
    contractId: string,
    disputeResolver: string,
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    const res = await this.client.withdrawRemainingFunds({
      contractId,
      disputeResolver,
      distributions: distributions.map((d) => ({ address: d.address, amount: toApiAmount(d.amount) })),
    });
    return { unsignedXdr: res.unsignedXdr };
  }

  async appendMilestones(contractId: string, milestones: MilestoneInput[]): Promise<Submitted> {
    if (milestones.length === 0) throw new AppError("VALIDATION", "no milestones to append");
    const res = await this.client.manageMilestones({
      contractId,
      admin: this.admin.publicKey(),
      newMilestones: milestones.map((m) => ({
        description: m.description.slice(0, 500),
        amount: toApiAmount(m.amount),
        receiver: m.receiver,
        approvalsTarget: 1,
      })),
    });
    return this.signAndSubmit(res.unsignedXdr, this.admin);
  }

  async markDelivered(contractId: string, updates: Array<{ index: number; evidence: string }>): Promise<Submitted> {
    if (updates.length === 0) throw new AppError("VALIDATION", "no milestones to mark");
    const res = await this.client.changeMilestoneStatus({
      contractId,
      serviceProvider: this.ops.publicKey(),
      updates: updates.map((u) => ({ index: u.index, newStatus: "completed", newEvidence: u.evidence.slice(0, 500) })),
    });
    return this.signAndSubmit(res.unsignedXdr, this.ops);
  }

  async submit(signedXdr: string): Promise<Submitted> {
    const r = await this.client.sendTransaction(signedXdr);
    return r.contractId ? { txHash: r.txHash, ledger: r.ledger, contractId: r.contractId } : { txHash: r.txHash, ledger: r.ledger };
  }

  async getEscrow(contractId: string): Promise<EscrowState> {
    return toState(await this.client.getEscrow(contractId));
  }

  private async signAndSubmit(unsignedXdr: string, signer: Keypair): Promise<Submitted> {
    const tx = TransactionBuilder.fromXDR(unsignedXdr, this.passphrase);
    tx.sign(signer);
    return this.submit(tx.toXDR());
  }
}

/** Contract-level constraints the API rejects; fail early with a clear message. */
function assertRoleSeparation(r: TwRoles): void {
  const others = new Set([...r.approvers, ...r.serviceProviders, ...r.releaseSigners, r.platform]);
  for (const dr of r.disputeResolvers) {
    if (others.has(dr) || dr === r.admin) throw new AppError("VALIDATION", "disputeResolver must not hold any other role");
  }
  if (others.has(r.admin)) throw new AppError("VALIDATION", "admin must not hold any other role");
}

function toState(e: TwEscrowRead): EscrowState {
  const funder = e.roles.approvers[0] ?? "";
  return {
    contractId: e.contractId,
    engagementId: e.engagementId,
    balance: fromApiAmount(e.balance ?? 0),
    roles: {
      funder,
      platformAdmin: e.roles.admin,
      platformOps: e.roles.serviceProviders[0] ?? "",
      disputeResolver: e.roles.disputeResolvers[0] ?? "",
      platformFeeAddress: e.roles.platform,
    },
    milestones: e.milestones.map((m, index) => ({
      index,
      description: m.description,
      amount: fromApiAmount(m.amount),
      receiver: m.receiver,
      status: m.status,
      evidence: m.evidence,
      approved: (m.approvals?.approvalCount ?? 0) >= (m.approvals?.target ?? 1),
      released: m.released,
      disputed: m.dispute?.isDisputed ?? false,
      resolved: m.dispute?.resolved ?? false,
    })),
  };
}
