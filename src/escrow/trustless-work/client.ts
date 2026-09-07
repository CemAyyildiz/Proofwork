import { z } from "zod";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Minimal typed client for the Trustless Work Core API v2 (multi-release).
 * Facts this encodes, verified against the current API reference:
 *   - every write builds a tx and returns { unsignedXdr, txHash }
 *   - submit is POST /stellar/send-transaction
 *   - auth header is x-api-key on every request, reads included
 *   - amounts are numbers in payloads; reads on the v2 controller return numbers
 *   - rate limit 50 req / 60 s — calls are serialised through a queue
 */

const unsignedSchema = z.object({
  unsignedXdr: z.string().min(1),
  txHash: z.string().optional(),
  contractId: z.string().optional(),
});

const submittedSchema = z.object({
  txHash: z.string().min(1),
  ledger: z.number().int(),
  contractId: z.string().optional(),
  code: z.string().optional(),
});

const milestoneSchema = z.object({
  description: z.string(),
  amount: z.number(),
  receiver: z.string(),
  status: z.string().default("pending"),
  evidence: z.string().default(""),
  approvals: z
    .object({ target: z.number(), approvalCount: z.number(), approvedBy: z.array(z.string()) })
    .optional(),
  released: z.boolean().default(false),
  dispute: z.object({ isDisputed: z.boolean(), reason: z.string(), resolved: z.boolean() }).optional(),
});

const escrowReadSchema = z.object({
  type: z.literal("multi-release"),
  contractId: z.string(),
  engagementId: z.string(),
  balance: z.number().optional(),
  roles: z.object({
    approvers: z.array(z.string()),
    serviceProviders: z.array(z.string()),
    releaseSigners: z.array(z.string()),
    disputeResolvers: z.array(z.string()),
    platform: z.string(),
    admin: z.string(),
  }),
  milestones: z.array(milestoneSchema),
});

export type TwUnsigned = z.infer<typeof unsignedSchema>;
export type TwSubmitted = z.infer<typeof submittedSchema>;
export type TwEscrowRead = z.infer<typeof escrowReadSchema>;

export interface TwRoles {
  approvers: string[];
  serviceProviders: string[];
  releaseSigners: string[];
  disputeResolvers: string[];
  platform: string;
  admin: string;
}

export class TrustlessWorkClient {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // ---- writes (build unsigned XDR) -------------------------------------

  deploy(body: {
    signer: string;
    engagementId: string;
    title: string;
    description: string;
    roles: TwRoles;
    platformFee: number;
    trustline: { symbol: string; address: string };
    milestones: [];
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/deploy", body, unsignedSchema);
  }

  fund(body: { contractId: string; signer: string; amount: number }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/fund", body, unsignedSchema);
  }

  manageMilestones(body: {
    contractId: string;
    admin: string;
    newMilestones: Array<{ description: string; amount: number; receiver: string; approvalsTarget: 1 }>;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/manage-milestones", body, unsignedSchema);
  }

  changeMilestoneStatus(body: {
    contractId: string;
    serviceProvider: string;
    updates: Array<{ index: number; newStatus: "completed"; newEvidence: string }>;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/change-milestone-status", body, unsignedSchema);
  }

  approveMilestones(body: { contractId: string; approver: string; milestoneIndexes: number[] }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/approve-milestones", body, unsignedSchema);
  }

  releaseFunds(body: { contractId: string; releaseSigner: string; milestoneIndexes: number[] }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/release-funds", body, unsignedSchema);
  }

  disputeMilestones(body: {
    contractId: string;
    signer: string;
    milestoneIndexes: number[];
    reason: string;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/dispute-milestones", body, unsignedSchema);
  }

  resolveDispute(body: {
    contractId: string;
    disputeResolver: string;
    milestoneIndexes: number[];
    distributions: Array<{ address: string; amount: number }>;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/resolve-dispute", body, unsignedSchema);
  }

  withdrawRemainingFunds(body: {
    contractId: string;
    disputeResolver: string;
    distributions: Array<{ address: string; amount: number }>;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/v2/withdraw-remaining-funds", body, unsignedSchema);
  }

  // ---- submit + reads ---------------------------------------------------

  sendTransaction(signedXdr: string): Promise<TwSubmitted> {
    return this.post("/stellar/send-transaction", { signedXdr }, submittedSchema);
  }

  getEscrow(contractId: string): Promise<TwEscrowRead> {
    return this.get(`/escrow/multi-release/v2/${encodeURIComponent(contractId)}`, escrowReadSchema);
  }

  // ---- transport ---------------------------------------------------------

  private post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.enqueue(() => this.request("POST", path, body, schema));
  }

  private get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.enqueue(() => this.request("GET", path, undefined, schema));
  }

  /** Serialises calls so a burst never trips the 50/min limit. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async request<T>(method: "GET" | "POST", path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (cause) {
      throw new AppError("ESCROW", `trustless work unreachable: ${path}`, { path }, { cause });
    }
    const text = await res.text();
    log.debug("tw request", { method, path, status: res.status, ms: Date.now() - started });

    if (!res.ok) {
      throw new AppError("ESCROW", `trustless work ${res.status} on ${path}`, {
        path,
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new AppError("ESCROW", `trustless work returned non-JSON on ${path}`, { path }, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("ESCROW", `trustless work response shape drifted on ${path}`, {
        path,
        issues: parsed.error.issues.slice(0, 5),
      });
    }
    return parsed.data;
  }
}
