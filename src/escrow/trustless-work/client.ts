import { z } from "zod";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Typed client for the Trustless Work Core API **v1** (multi-release), the
 * production protocol, on the testnet host. Facts this encodes, verified
 * against the live swagger (`/docs-json`) and the protocol reference:
 *   - every write builds a tx and returns { unsignedTransaction }
 *   - submit is POST /helper/send-transaction { signedXdr }
 *   - auth header is x-api-key on every request, reads included
 *   - amounts are numbers; milestoneIndex is a string ("0")
 *   - after funding, update-escrow may only append milestones
 *   - rate limit 50 req / 60 s — calls are serialised through a queue
 */

const unsignedSchema = z.object({ unsignedTransaction: z.string().min(1) });

/** send-transaction's body is not versioned in swagger; we keep what we can and derive the hash locally. */
const submittedSchema = z
  .object({ contractId: z.string().optional(), status: z.string().optional(), message: z.string().optional() })
  .passthrough();

const flagsSchema = z
  .object({
    approved: z.boolean().optional(),
    released: z.boolean().optional(),
    disputed: z.boolean().optional(),
    resolved: z.boolean().optional(),
  })
  .partial();

const milestoneSchema = z
  .object({
    description: z.string(),
    amount: z.union([z.number(), z.string()]),
    receiver: z.string(),
    status: z.string().optional(),
    evidence: z.string().optional(),
    flags: flagsSchema.optional(),
  })
  .passthrough();

const rolesSchema = z.object({
  approver: z.string(),
  serviceProvider: z.string(),
  platformAddress: z.string(),
  releaseSigner: z.string(),
  disputeResolver: z.string(),
});

const escrowReadSchema = z
  .object({
    contractId: z.string(),
    engagementId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    balance: z.union([z.number(), z.string()]).optional(),
    platformFee: z.union([z.number(), z.string()]).optional(),
    receiverMemo: z.number().optional(),
    roles: rolesSchema,
    milestones: z.array(milestoneSchema),
    flags: flagsSchema.optional(),
    trustline: z.object({ address: z.string(), symbol: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export type TwUnsigned = z.infer<typeof unsignedSchema>;
export type TwSubmitted = z.infer<typeof submittedSchema>;
export type TwEscrowRead = z.infer<typeof escrowReadSchema>;
export type TwRoles = z.infer<typeof rolesSchema>;
export type TwMilestoneRead = z.infer<typeof milestoneSchema>;

export interface TwMilestoneWrite {
  description: string;
  amount: number;
  receiver: string;
  status?: string;
  evidence?: string;
  flags?: { approved?: boolean; released?: boolean; disputed?: boolean; resolved?: boolean };
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
    milestones: Array<{ description: string; amount: number; receiver: string }>;
    trustline: { address: string; symbol: string };
  }): Promise<TwUnsigned> {
    return this.post("/deployer/multi-release", body, unsignedSchema);
  }

  fund(body: { contractId: string; signer: string; amount: number }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/fund-escrow", body, unsignedSchema);
  }

  /** Full escrow state back, plus appended milestones. Signed by platformAddress. */
  updateEscrow(body: {
    signer: string;
    contractId: string;
    escrow: {
      engagementId: string;
      title: string;
      description: string;
      roles: TwRoles;
      platformFee: number;
      milestones: TwMilestoneWrite[];
      trustline: { address: string; symbol?: string };
      receiverMemo?: number;
    };
  }): Promise<TwUnsigned> {
    return this.put("/escrow/multi-release/update-escrow", body, unsignedSchema);
  }

  changeMilestoneStatus(body: {
    contractId: string;
    serviceProvider: string;
    milestoneIndex: string;
    newStatus: string;
    newEvidence: string;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/change-milestone-status", body, unsignedSchema);
  }

  approveMilestone(body: { contractId: string; approver: string; milestoneIndex: string }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/approve-milestone", body, unsignedSchema);
  }

  releaseMilestoneFunds(body: { contractId: string; releaseSigner: string; milestoneIndex: string }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/release-milestone-funds", body, unsignedSchema);
  }

  disputeMilestone(body: { contractId: string; signer: string; milestoneIndex: string }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/dispute-milestone", body, unsignedSchema);
  }

  resolveMilestoneDispute(body: {
    contractId: string;
    disputeResolver: string;
    milestoneIndex: string;
    distributions: Array<{ address: string; amount: number }>;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/resolve-milestone-dispute", body, unsignedSchema);
  }

  withdrawRemainingFunds(body: {
    contractId: string;
    disputeResolver: string;
    distributions: Array<{ address: string; amount: number }>;
  }): Promise<TwUnsigned> {
    return this.post("/escrow/multi-release/withdraw-remaining-funds", body, unsignedSchema);
  }

  // ---- submit + reads ---------------------------------------------------

  sendTransaction(signedXdr: string): Promise<TwSubmitted> {
    return this.post("/helper/send-transaction", { signedXdr }, submittedSchema);
  }

  async getEscrow(contractId: string): Promise<TwEscrowRead> {
    const q = new URLSearchParams([["contractIds[]", contractId], ["validateOnChain", "true"]]);
    const rows = await this.get(`/helper/get-escrow-by-contract-ids?${q.toString()}`, z.array(escrowReadSchema));
    const row = rows.find((r) => r.contractId === contractId) ?? rows[0];
    if (!row) throw new AppError("ESCROW", "escrow not found", { contractId });
    return row;
  }

  // ---- transport ---------------------------------------------------------

  private post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.enqueue(() => this.request("POST", path, body, schema));
  }

  private put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.enqueue(() => this.request("PUT", path, body, schema));
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

  private async request<T>(method: "GET" | "POST" | "PUT", path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      throw new AppError("ESCROW", `trustless work unreachable: ${path}`, { path }, { cause });
    }
    const text = await res.text();
    log.debug("tw request", { method, path: path.split("?")[0], status: res.status, ms: Date.now() - started });

    if (!res.ok) {
      throw new AppError("ESCROW", `trustless work ${res.status} on ${path.split("?")[0]}`, {
        path: path.split("?")[0],
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
      throw new AppError("ESCROW", `trustless work response shape drifted on ${path.split("?")[0]}`, {
        path: path.split("?")[0],
        issues: parsed.error.issues.slice(0, 5),
        sample: text.slice(0, 300),
      });
    }
    return parsed.data;
  }
}
