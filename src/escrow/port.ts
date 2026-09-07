/**
 * Vendor-neutral escrow boundary (AD-8). Services depend on this interface;
 * only `trustless-work/` knows the provider's API. Two kinds of operation:
 *
 *   build*  — return an unsigned XDR for a *user* wallet to sign (funder).
 *             The caller signs client-side and passes the result to `submit`.
 *   server  — operations the platform signs itself with a server key
 *             (append milestones, mark delivered). They submit internally.
 *
 * Amounts are decimal strings ("10.5"), never floats, at this boundary.
 */

export interface EscrowRoles {
  funder: string; // approver + releaseSigner
  platformAdmin: string; // admin
  platformOps: string; // serviceProvider
  disputeResolver: string;
  platformFeeAddress: string;
}

export interface DeployInput {
  engagementId: string; // campaign slug
  title: string;
  description: string;
  roles: EscrowRoles;
  signer: string; // funder public key
}

export interface MilestoneInput {
  description: string; // submission short id + url
  amount: string;
  receiver: string; // contributor public key
}

export interface EscrowMilestone {
  index: number;
  description: string;
  amount: string;
  receiver: string;
  status: string;
  evidence: string;
  approved: boolean;
  released: boolean;
  disputed: boolean;
  resolved: boolean;
}

export interface EscrowState {
  contractId: string;
  engagementId: string;
  balance: string;
  milestones: EscrowMilestone[];
  roles: EscrowRoles;
}

export interface Unsigned {
  unsignedXdr: string;
  /** predicted contract id, deploy only */
  contractId?: string;
}

export interface Submitted {
  txHash: string;
  ledger: number;
  contractId?: string;
}

export interface EscrowPort {
  buildDeploy(input: DeployInput): Promise<Unsigned>;
  buildFund(contractId: string, signer: string, amount: string): Promise<Unsigned>;
  buildApprove(contractId: string, approver: string, milestoneIndexes: number[]): Promise<Unsigned>;
  buildRelease(contractId: string, releaseSigner: string, milestoneIndexes: number[]): Promise<Unsigned>;
  buildDispute(contractId: string, signer: string, milestoneIndexes: number[], reason: string): Promise<Unsigned>;
  buildResolve(
    contractId: string,
    disputeResolver: string,
    milestoneIndexes: number[],
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned>;
  buildWithdrawRemaining(
    contractId: string,
    disputeResolver: string,
    distributions: Array<{ address: string; amount: string }>,
  ): Promise<Unsigned>;

  /** platform-signed: append per-submission milestones after funding */
  appendMilestones(contractId: string, milestones: MilestoneInput[]): Promise<Submitted>;
  /** platform-signed: mark milestones delivered with the submission URL as evidence */
  markDelivered(contractId: string, updates: Array<{ index: number; evidence: string }>): Promise<Submitted>;

  submit(signedXdr: string): Promise<Submitted>;
  getEscrow(contractId: string): Promise<EscrowState>;
}
