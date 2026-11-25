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
  /** Configured PUBLIC_FUNDING_SOURCES (Friendbot not included). */
  publicFundingSources: readonly string[];
  /** Spendable XLM of an account as a decimal string, or null when the account does not exist. */
  spendableXlm: (pubkey: string) => Promise<string | null>;
  /** Whether an account holds a trustline to the configured USDC issuer. */
  hasUsdcTrustline: (pubkey: string) => Promise<boolean>;
  /** Resolves when Trustless Work accepts the API key on the configured host. */
  trustlessWork: () => Promise<void>;
  /** Migrations recorded in the database against those in the repository. */
  migrations: () => Promise<{ applied: number; expected: number }>;
  /** Campaigns already in the database. */
  campaignCount: () => Promise<number>;
}

export interface PreflightLine {
  ok: boolean;
  /** Passes, but the operator should look: printed as WARN and does not fail the run. */
  warn?: boolean;
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
  // Trustless Work refuses to deploy an escrow whose platformAddress cannot hold the asset.
  try {
    lines.push(
      (await input.hasUsdcTrustline(admin))
        ? { ok: true, text: `platform admin ${short(admin)} holds the USDC trustline` }
        : { ok: false, text: `platform admin ${short(admin)} has no USDC trustline: Trustless Work refuses every escrow deploy until it does` },
    );
  } catch (e) {
    lines.push({ ok: false, text: `platform admin ${short(admin)} trustline could not be read: ${reason(e)}` });
  }

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

  try {
    const n = await input.campaignCount();
    lines.push(
      n > 0 && input.network === "mainnet"
        ? { ok: true, warn: true, text: `database already holds ${n} campaign(s): a mainnet deployment starts on a new, empty database, not a reused testnet one` }
        : { ok: true, text: `database holds ${n} campaign(s)` },
    );
  } catch (e) {
    lines.push({ ok: false, text: `campaigns could not be counted: ${reason(e)}` });
  }

  const sources = input.publicFundingSources.length;
  lines.push(
    sources === 0 && input.network === "mainnet"
      ? {
          ok: true,
          warn: true,
          text: "PUBLIC_FUNDING_SOURCES is empty: contributors who withdrew from the same exchange will be flagged to reviewers as linked",
        }
      : { ok: true, text: `public funding sources: ${sources} configured${input.network === "testnet" ? " besides Friendbot" : ""}` },
  );

  lines.push({
    ok: true,
    text: `funder caps: ${input.limits.maxOpenCampaigns} open campaigns and ${input.limits.maxOpenBudget} USDC of open budget per funder${
      input.network === "mainnet" ? " (real USDC: confirm these are the values you mean)" : ""
    }`,
  });
  return lines;
}
