import type { StellarNetwork } from "@/config/network";

/**
 * `pnpm preflight`: what must be true before a deployment takes a campaign.
 * Read-only. Each check answers for itself, so one failure never hides the
 * next. No line carries a secret: accounts are named by role and public key.
 */
export interface PreflightInput {
  network: StellarNetwork;
  /** Public keys of the three server accounts. */
  serverAccounts: { admin: string; ops: string; ledger: string };
  /** The resolver offered in the campaign form, if one is configured. */
  resolver: string | undefined;
  xConfigured: boolean;
  rateLimitConfigured: boolean;
  limits: { maxOpenCampaigns: number; maxOpenBudget: string };
  /** Spendable XLM of an account as a decimal string, or null when the account does not exist. */
  spendableXlm: (pubkey: string) => Promise<string | null>;
  /** Resolves when Trustless Work accepts the API key on the configured host. */
  trustlessWork: () => Promise<void>;
  /** Migrations recorded in the database against those in the repository. */
  migrations: () => Promise<{ applied: number; expected: number }>;
}

export interface PreflightLine {
  ok: boolean;
  text: string;
}

/** A server account pays a network fee for every decision, milestone and approval it signs. */
export const MIN_SERVER_XLM = 2;

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (pubkey: string) => `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;

async function account(label: string, pubkey: string, min: number, read: PreflightInput["spendableXlm"]): Promise<PreflightLine> {
  try {
    const xlm = await read(pubkey);
    if (xlm === null) return { ok: false, text: `${label} ${short(pubkey)} does not exist on the network: send XLM to it` };
    return Number(xlm) >= min
      ? { ok: true, text: `${label} ${short(pubkey)} exists with ${xlm} XLM free` }
      : { ok: false, text: `${label} ${short(pubkey)} has ${xlm} XLM free and needs at least ${min}` };
  } catch (e) {
    return { ok: false, text: `${label} ${short(pubkey)} could not be read: ${reason(e)}` };
  }
}

export async function preflight(input: PreflightInput): Promise<PreflightLine[]> {
  const lines: PreflightLine[] = [{ ok: true, text: `network: ${input.network}; the server and the build agree` }];
  const { admin, ops, ledger } = input.serverAccounts;

  lines.push(await account("platform admin", admin, MIN_SERVER_XLM, input.spendableXlm));
  lines.push(await account("platform ops", ops, MIN_SERVER_XLM, input.spendableXlm));
  lines.push(await account("decision ledger", ledger, MIN_SERVER_XLM, input.spendableXlm));

  if (!input.resolver) {
    lines.push({ ok: false, text: "dispute resolver: DEFAULT_DISPUTE_RESOLVER_PUBKEY is not set, so every funder has to type a resolver key" });
  } else if ([admin, ops, ledger].includes(input.resolver)) {
    lines.push({ ok: false, text: "dispute resolver is one of the server keys: it must be a key that never reaches the server" });
  } else {
    // The resolver only pays the fee of a remainder return, so one transaction's worth is enough.
    lines.push(await account("dispute resolver", input.resolver, 0.5, input.spendableXlm));
  }

  try {
    await input.trustlessWork();
    lines.push({ ok: true, text: "Trustless Work accepts the API key on the configured host" });
  } catch (e) {
    lines.push({ ok: false, text: `Trustless Work refused the request: ${reason(e)}` });
  }

  lines.push(
    input.xConfigured
      ? { ok: true, text: "X credentials are set" }
      : { ok: false, text: "X credentials are not set: no campaign can take a submission" },
  );
  lines.push(
    input.rateLimitConfigured
      ? { ok: true, text: "rate limiting has its Redis credentials" }
      : { ok: false, text: "rate limiting has no Redis credentials (UPSTASH_REDIS_REST_URL and _TOKEN)" },
  );

  try {
    const m = await input.migrations();
    lines.push(
      m.applied === m.expected
        ? { ok: true, text: `database has all ${m.expected} migrations` }
        : { ok: false, text: `database has ${m.applied} of ${m.expected} migrations: run pnpm db:migrate` },
    );
  } catch (e) {
    lines.push({ ok: false, text: `database could not be read: ${reason(e)}` });
  }

  lines.push({
    ok: true,
    text: `funder caps: ${input.limits.maxOpenCampaigns} open campaigns and ${input.limits.maxOpenBudget} USDC of open budget per funder${
      input.network === "mainnet" ? " (real USDC: confirm these are the values you mean)" : ""
    }`,
  });
  return lines;
}
