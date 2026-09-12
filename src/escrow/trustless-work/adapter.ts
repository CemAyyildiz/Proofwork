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
import {
  TrustlessWorkClient,
  type TwEscrowRead,
  type TwMilestoneRead,
  type TwMilestoneWrite,
  type TwRoles,
} from "./client";

export interface TrustlessWorkAdapterOptions {
  client: TrustlessWorkClient;
  usdcIssuer: string;
  /** escrow role `platformAddress` — appends milestones via update-escrow */
  platformAdmin: Keypair;
  /** escrow role `serviceProvider` — marks milestones delivered */
  platformOps: Keypair;
  networkPassphrase?: string;
}

/**
 * Trustless Work v1 multi-release implementation of EscrowPort (AD-1, AD-2).
 * Server keys sign only the two operations that move no money. Transaction
 * hashes are derived from the signed XDR, never trusted from the API body.
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
    const roles = toTwRoles(r);
    assertRoleSeparation(roles);
    const res = await this.client.deploy({
      signer: input.signer,
      engagementId: input.engagementId.slice(0, 100),
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 500),
      roles,
      platformFee: 0,
      milestones: [
        {
          description: input.closeMilestone.description.slice(0, 500),
          amount: toApiAmount(input.closeMilestone.amount),
          receiver: r.funder,
        },
      ],
      trustline: { address: this.usdcIssuer, symbol: "USDC" },
    });
    return { unsignedXdr: res.unsignedTransaction };
  }

  async buildFund(contractId: string, signer: string, amount: string): Promise<Unsigned> {
    const res = await this.client.fund({ contractId, signer, amount: toApiAmount(amount) });
    return { unsignedXdr: res.unsignedTransaction };
  }


  async buildRelease(contractId: string, releaseSigner: string, milestoneIndexes: number[]): Promise<Unsigned[]> {
    const out: Unsigned[] = [];
    for (const i of milestoneIndexes) {
      const res = await this.client.releaseMilestoneFunds({ contractId, releaseSigner, milestoneIndex: String(i) });
      out.push({ unsignedXdr: res.unsignedTransaction, milestoneIndex: i });
    }
    return out;
  }

  async buildDispute(contractId: string, signer: string, milestoneIndexes: number[]): Promise<Unsigned[]> {
    const out: Unsigned[] = [];
    for (const i of milestoneIndexes) {
      const res = await this.client.disputeMilestone({ contractId, signer, milestoneIndex: String(i) });
      out.push({ unsignedXdr: res.unsignedTransaction, milestoneIndex: i });
    }
    return out;
  }

  async buildResolve(
    contractId: string,
    disputeResolver: string,
    milestoneIndex: number,
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    const res = await this.client.resolveMilestoneDispute({
      contractId,
      disputeResolver,
      milestoneIndex: String(milestoneIndex),
      distributions: distributions.map((d) => ({ address: d.address, amount: toApiAmount(d.amount) })),
    });
    return { unsignedXdr: res.unsignedTransaction, milestoneIndex };
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
    return { unsignedXdr: res.unsignedTransaction };
  }

  /**
   * v1 has no append endpoint: update-escrow takes the full desired state.
   * After funding the contract accepts only appended milestones, so we read
   * the current escrow, echo it back unchanged and add the new entries.
   */
  async appendMilestones(contractId: string, milestones: MilestoneInput[]): Promise<Submitted> {
    if (milestones.length === 0) throw new AppError("VALIDATION", "no milestones to append");
    const current = await this.client.getEscrow(contractId);
    if (current.roles.platformAddress !== this.admin.publicKey()) {
      throw new AppError("ESCROW", "escrow platformAddress is not the configured platform admin key");
    }
    for (const m of milestones) {
      if (m.receiver === current.roles.disputeResolver) {
        throw new AppError("VALIDATION", "receiver cannot be the dispute resolver");
      }
    }
    const existing: TwMilestoneWrite[] = current.milestones.map(echoMilestone);
    const appended: TwMilestoneWrite[] = milestones.map((m) => ({
      description: m.description.slice(0, 500),
      amount: toApiAmount(m.amount),
      receiver: m.receiver,
    }));
    if (existing.length + appended.length > 50) throw new AppError("VALIDATION", "escrow cannot exceed 50 milestones");

    const res = await this.client.updateEscrow({
      signer: this.admin.publicKey(),
      contractId,
      escrow: {
        engagementId: current.engagementId,
        title: current.title ?? "",
        description: current.description ?? "",
        roles: current.roles,
        platformFee: Number(current.platformFee ?? 0),
        milestones: [...existing, ...appended],
        trustline: { address: current.trustline?.address ?? this.usdcIssuer, symbol: "USDC" },
        ...(current.receiverMemo !== undefined ? { receiverMemo: current.receiverMemo } : {}),
      },
    });
    return this.signAndSubmit(res.unsignedTransaction, this.admin);
  }

  async markDelivered(contractId: string, updates: Array<{ index: number; evidence: string }>): Promise<Submitted[]> {
    if (updates.length === 0) throw new AppError("VALIDATION", "no milestones to mark");
    const out: Submitted[] = [];
    for (const u of updates) {
      const res = await this.client.changeMilestoneStatus({
        contractId,
        serviceProvider: this.ops.publicKey(),
        milestoneIndex: String(u.index),
        newStatus: "completed",
        newEvidence: u.evidence.slice(0, 500),
      });
      out.push(await this.signAndSubmit(res.unsignedTransaction, this.ops));
    }
    return out;
  }

  async approveMilestones(contractId: string, milestoneIndexes: number[]): Promise<Submitted[]> {
    if (milestoneIndexes.length === 0) throw new AppError("VALIDATION", "no milestones to approve");
    const out: Submitted[] = [];
    for (const i of milestoneIndexes) {
      const res = await this.client.approveMilestone({ contractId, approver: this.ops.publicKey(), milestoneIndex: String(i) });
      out.push(await this.signAndSubmit(res.unsignedTransaction, this.ops));
    }
    return out;
  }

  async submit(signedXdr: string): Promise<Submitted> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.passphrase);
    const txHash = tx.hash().toString("hex");
    const r = await this.client.sendTransaction(signedXdr);
    return r.contractId ? { txHash, contractId: r.contractId } : { txHash };
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

function toTwRoles(r: EscrowState["roles"]): TwRoles {
  return {
    approver: r.platformOps,
    releaseSigner: r.funder,
    serviceProvider: r.platformOps,
    platformAddress: r.platformAdmin,
    disputeResolver: r.disputeResolver,
  };
}

/**
 * The contract rejects a disputeResolver that also holds another role. We
 * additionally refuse a releaseSigner that is a platform key: money must
 * only move on the funder's signature.
 */
function assertRoleSeparation(r: TwRoles): void {
  const others = [r.approver, r.releaseSigner, r.serviceProvider, r.platformAddress];
  if (others.includes(r.disputeResolver)) {
    throw new AppError("VALIDATION", "disputeResolver must not hold any other role");
  }
  if (r.releaseSigner === r.serviceProvider || r.releaseSigner === r.platformAddress) {
    throw new AppError("VALIDATION", "releaseSigner must not be a platform key");
  }
}

function echoMilestone(m: TwMilestoneRead): TwMilestoneWrite {
  const flags = m.flags
    ? {
        ...(m.flags.approved !== undefined ? { approved: m.flags.approved } : {}),
        ...(m.flags.released !== undefined ? { released: m.flags.released } : {}),
        ...(m.flags.disputed !== undefined ? { disputed: m.flags.disputed } : {}),
        ...(m.flags.resolved !== undefined ? { resolved: m.flags.resolved } : {}),
      }
    : undefined;
  return {
    description: m.description,
    amount: typeof m.amount === "string" ? Number(m.amount) : m.amount,
    receiver: m.receiver,
    ...(m.status !== undefined ? { status: m.status } : {}),
    ...(m.evidence !== undefined ? { evidence: m.evidence } : {}),
    ...(flags ? { flags } : {}),
  };
}

function toState(e: TwEscrowRead): EscrowState {
  return {
    contractId: e.contractId,
    engagementId: e.engagementId,
    balance: fromApiAmount(Number(e.balance ?? 0)),
    roles: {
      funder: e.roles.releaseSigner,
      platformAdmin: e.roles.platformAddress,
      platformOps: e.roles.serviceProvider,
      disputeResolver: e.roles.disputeResolver,
    },
    milestones: e.milestones.map((m, index) => ({
      index,
      description: m.description,
      amount: fromApiAmount(Number(m.amount)),
      receiver: m.receiver,
      status: m.status ?? "",
      evidence: m.evidence ?? "",
      approved: m.flags?.approved ?? false,
      released: m.flags?.released ?? false,
      disputed: m.flags?.disputed ?? false,
      resolved: m.flags?.resolved ?? false,
    })),
  };
}
