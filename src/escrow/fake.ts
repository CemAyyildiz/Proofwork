import { addAmounts, subAmounts, toStroops } from "./amount";
import type {
  DeployInput,
  EscrowMilestone,
  EscrowPort,
  EscrowState,
  MilestoneInput,
  Submitted,
  Unsigned,
} from "./port";

/**
 * In-memory EscrowPort for unit tests. Models the v1 multi-release rules the
 * services rely on: deploy carries the close milestone, append allowed after
 * funding, approve before release, per-milestone release, withdraw-remaining
 * only when every milestone is released, resolved or disputed.
 */
export class FakeEscrow implements EscrowPort {
  readonly escrows = new Map<string, EscrowState>();
  private seq = 0;
  private pending = new Map<string, () => string | undefined>();

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString().padStart(4, "0")}`;
  }

  private defer(action: () => string | undefined, milestoneIndex?: number): Unsigned {
    const xdr = this.next("xdr");
    this.pending.set(xdr, action);
    return milestoneIndex === undefined ? { unsignedXdr: xdr } : { unsignedXdr: xdr, milestoneIndex };
  }

  private state(contractId: string): EscrowState {
    const s = this.escrows.get(contractId);
    if (!s) throw new Error(`fake escrow ${contractId} not found`);
    return s;
  }

  async buildDeploy(input: DeployInput): Promise<Unsigned> {
    const contractId = this.next("C");
    return this.defer(() => {
      this.escrows.set(contractId, {
        contractId,
        engagementId: input.engagementId,
        balance: "0",
        milestones: [
          blank(0, input.closeMilestone.description, input.closeMilestone.amount, input.roles.funder),
        ],
        roles: input.roles,
      });
      return contractId;
    });
  }

  async buildFund(contractId: string, _signer: string, amount: string): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      s.balance = addAmounts(s.balance, amount);
      return undefined;
    });
  }

  async buildApprove(contractId: string, approver: string, idx: number[]): Promise<Unsigned[]> {
    return idx.map((i) =>
      this.defer(() => {
        const s = this.state(contractId);
        if (approver !== s.roles.funder) throw new Error("not an approver");
        const m = this.milestone(s, i);
        if (m.approved) throw new Error(`milestone ${i} already approved`);
        m.approved = true;
        return undefined;
      }, i),
    );
  }

  async buildRelease(contractId: string, releaseSigner: string, idx: number[]): Promise<Unsigned[]> {
    return idx.map((i) =>
      this.defer(() => {
        const s = this.state(contractId);
        if (releaseSigner !== s.roles.funder) throw new Error("not a release signer");
        const m = this.milestone(s, i);
        if (!m.approved || m.released || m.disputed) throw new Error(`milestone ${i} not releasable`);
        s.balance = subAmounts(s.balance, m.amount);
        m.released = true;
        return undefined;
      }, i),
    );
  }

  async buildDispute(contractId: string, signer: string, idx: number[]): Promise<Unsigned[]> {
    return idx.map((i) =>
      this.defer(() => {
        const s = this.state(contractId);
        if (signer === s.roles.disputeResolver) throw new Error("disputeResolver cannot raise a dispute");
        const m = this.milestone(s, i);
        if (m.released || m.resolved) throw new Error(`milestone ${i} is terminal`);
        m.disputed = true;
        return undefined;
      }, i),
    );
  }

  async buildResolve(
    contractId: string,
    _dr: string,
    i: number,
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      const m = this.milestone(s, i);
      if (!m.disputed || m.resolved) throw new Error(`milestone ${i} not disputed`);
      let total = "0";
      for (const d of distributions) total = addAmounts(total, d.amount);
      if (toStroops(total) > toStroops(m.amount)) throw new Error("distributions exceed milestone amount");
      s.balance = subAmounts(s.balance, total);
      m.resolved = true;
      return undefined;
    }, i);
  }

  async buildWithdrawRemaining(
    contractId: string,
    _dr: string,
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      if (!s.milestones.every((m) => m.released || m.resolved || m.disputed)) {
        throw new Error("not every milestone is fully processed");
      }
      let total = "0";
      for (const d of distributions) total = addAmounts(total, d.amount);
      if (toStroops(total) === 0n || toStroops(total) > toStroops(s.balance)) throw new Error("invalid withdraw total");
      s.balance = subAmounts(s.balance, total);
      return undefined;
    });
  }

  async appendMilestones(contractId: string, milestones: MilestoneInput[]): Promise<Submitted> {
    const s = this.state(contractId);
    for (const m of milestones) {
      if (m.receiver === s.roles.disputeResolver) throw new Error("receiver cannot be the dispute resolver");
      s.milestones.push(blank(s.milestones.length, m.description, m.amount, m.receiver));
    }
    return { txHash: this.next("tx") };
  }

  async markDelivered(contractId: string, updates: Array<{ index: number; evidence: string }>): Promise<Submitted[]> {
    const s = this.state(contractId);
    return updates.map((u) => {
      const m = this.milestone(s, u.index);
      m.status = "completed";
      m.evidence = u.evidence;
      return { txHash: this.next("tx") };
    });
  }

  async submit(signedXdr: string): Promise<Submitted> {
    const action = this.pending.get(signedXdr);
    if (!action) throw new Error("unknown xdr");
    this.pending.delete(signedXdr);
    const contractId = action();
    return contractId ? { txHash: this.next("tx"), contractId } : { txHash: this.next("tx") };
  }

  async getEscrow(contractId: string): Promise<EscrowState> {
    return structuredClone(this.state(contractId));
  }

  private milestone(s: EscrowState, i: number): EscrowMilestone {
    const m = s.milestones[i];
    if (!m) throw new Error(`milestone ${i} not found`);
    return m;
  }
}

function blank(index: number, description: string, amount: string, receiver: string): EscrowMilestone {
  return { index, description, amount, receiver, status: "pending", evidence: "", approved: false, released: false, disputed: false, resolved: false };
}
