import { addAmounts, subAmounts } from "./amount";
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
 * In-memory EscrowPort for unit tests. Models the v2 multi-release rules the
 * services rely on: fund before append, approve before release, per-milestone
 * release, withdraw-remaining only when every milestone is terminal.
 */
export class FakeEscrow implements EscrowPort {
  readonly escrows = new Map<string, EscrowState>();
  private seq = 0;
  private pending = new Map<string, () => void>();

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString().padStart(4, "0")}`;
  }

  private defer(action: () => void): Unsigned {
    const xdr = this.next("xdr");
    this.pending.set(xdr, action);
    return { unsignedXdr: xdr };
  }

  private state(contractId: string): EscrowState {
    const s = this.escrows.get(contractId);
    if (!s) throw new Error(`fake escrow ${contractId} not found`);
    return s;
  }

  async buildDeploy(input: DeployInput): Promise<Unsigned> {
    const contractId = this.next("C");
    const u = this.defer(() => {
      this.escrows.set(contractId, {
        contractId,
        engagementId: input.engagementId,
        balance: "0",
        milestones: [],
        roles: input.roles,
      });
    });
    return { ...u, contractId };
  }

  async buildFund(contractId: string, _signer: string, amount: string): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      s.balance = addAmounts(s.balance, amount);
    });
  }

  async buildApprove(contractId: string, approver: string, idx: number[]): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      if (approver !== s.roles.funder) throw new Error("not an approver");
      for (const i of idx) {
        const m = this.milestone(s, i);
        if (m.approved) throw new Error(`milestone ${i} already approved`);
        m.approved = true;
      }
    });
  }

  async buildRelease(contractId: string, releaseSigner: string, idx: number[]): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      if (releaseSigner !== s.roles.funder) throw new Error("not a release signer");
      for (const i of idx) {
        const m = this.milestone(s, i);
        if (!m.approved || m.released || m.disputed) throw new Error(`milestone ${i} not releasable`);
        s.balance = subAmounts(s.balance, m.amount);
        m.released = true;
      }
    });
  }

  async buildDispute(contractId: string, _signer: string, idx: number[]): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      for (const i of idx) this.milestone(s, i).disputed = true;
    });
  }

  async buildResolve(
    contractId: string,
    _dr: string,
    idx: number[],
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      let total = "0";
      for (const d of distributions) total = addAmounts(total, d.amount);
      s.balance = subAmounts(s.balance, total);
      for (const i of idx) {
        const m = this.milestone(s, i);
        m.resolved = true;
      }
    });
  }

  async buildWithdrawRemaining(
    contractId: string,
    _dr: string,
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned> {
    return this.defer(() => {
      const s = this.state(contractId);
      if (!s.milestones.every((m) => m.released || m.resolved)) throw new Error("not every milestone is terminal");
      let total = "0";
      for (const d of distributions) total = addAmounts(total, d.amount);
      if (total !== s.balance) throw new Error("withdraw must sweep the entire balance");
      s.balance = "0";
    });
  }

  async appendMilestones(contractId: string, milestones: MilestoneInput[]): Promise<Submitted> {
    const s = this.state(contractId);
    if (s.milestones.some((m) => m.released || m.disputed)) throw new Error("append not allowed after release/dispute");
    for (const m of milestones) {
      if (m.receiver === s.roles.platformAdmin || m.receiver === s.roles.disputeResolver) {
        throw new Error("receiver cannot be admin or disputeResolver");
      }
      s.milestones.push({
        index: s.milestones.length,
        description: m.description,
        amount: m.amount,
        receiver: m.receiver,
        status: "pending",
        evidence: "",
        approved: false,
        released: false,
        disputed: false,
        resolved: false,
      });
    }
    return { txHash: this.next("tx"), ledger: this.seq };
  }

  async markDelivered(contractId: string, updates: Array<{ index: number; evidence: string }>): Promise<Submitted> {
    const s = this.state(contractId);
    for (const u of updates) {
      const m = this.milestone(s, u.index);
      m.status = "completed";
      m.evidence = u.evidence;
    }
    return { txHash: this.next("tx"), ledger: this.seq };
  }

  async submit(signedXdr: string): Promise<Submitted> {
    const action = this.pending.get(signedXdr);
    if (!action) throw new Error("unknown xdr");
    this.pending.delete(signedXdr);
    action();
    return { txHash: this.next("tx"), ledger: this.seq };
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
