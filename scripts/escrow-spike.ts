import { mkdir, writeFile } from "node:fs/promises";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { z } from "zod";
import { TrustlessWorkAdapter } from "../src/escrow/trustless-work/adapter";
import { TrustlessWorkClient } from "../src/escrow/trustless-work/client";
import type { DecisionRecord } from "../src/ledger/canonical";
import { HorizonDecisionLedger } from "../src/ledger/decision-ledger";

/**
 * Week 1 spike (architecture §9). Proves, on testnet, every on-chain step the
 * campaign depends on and writes the evidence to docs/evidence/escrow-cycle.md.
 *
 *   pnpm spike
 *
 * Requires in .env: TW_API_KEY, PLATFORM_ADMIN_SECRET, PLATFORM_OPS_SECRET,
 * DECISION_LEDGER_SECRET, FUNDER_SECRET, DISPUTE_RESOLVER_SECRET, and the
 * funder account holding testnet USDC. Run `pnpm accounts:prepare` first.
 */

const seed = z.string().refine((v) => StrKey.isValidEd25519SecretSeed(v), "invalid secret seed");
const env = z
  .object({
    TW_BASE_URL: z.string().url().default("https://dev.api.trustlesswork.com"),
    TW_API_KEY: z.string().min(16),
    HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
    USDC_ISSUER: z.string().default("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    PLATFORM_ADMIN_SECRET: seed,
    PLATFORM_OPS_SECRET: seed,
    DECISION_LEDGER_SECRET: seed,
    FUNDER_SECRET: seed,
    DISPUTE_RESOLVER_SECRET: seed,
  })
  .parse(process.env);

const horizon = new Horizon.Server(env.HORIZON_URL);
const USDC = new Asset("USDC", env.USDC_ISSUER);
const FUND = "5";
const REWARD = "1";
const CLOSE_AMOUNT = "0.0000001";

const admin = Keypair.fromSecret(env.PLATFORM_ADMIN_SECRET);
const ops = Keypair.fromSecret(env.PLATFORM_OPS_SECRET);
const funder = Keypair.fromSecret(env.FUNDER_SECRET);
const resolver = Keypair.fromSecret(env.DISPUTE_RESOLVER_SECRET);
const contributor = Keypair.random();

const evidence: Array<{ step: string; txHash: string; note?: string }> = [];
const record = (step: string, txHash: string, note?: string) => {
  evidence.push(note ? { step, txHash, note } : { step, txHash });
  process.stdout.write(`✔ ${step}: ${txHash}${note ? `  (${note})` : ""}\n`);
};

async function ensureFunded(kp: Keypair): Promise<void> {
  try {
    await horizon.loadAccount(kp.publicKey());
  } catch {
    const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    if (!r.ok) throw new Error(`friendbot failed for ${kp.publicKey()}`);
    process.stdout.write(`  friendbot funded ${kp.publicKey()}\n`);
  }
}

async function ensureTrustline(kp: Keypair): Promise<void> {
  const acct = await horizon.loadAccount(kp.publicKey());
  const has = acct.balances.some((b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === env.USDC_ISSUER);
  if (has) return;
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  record(`trustline ${kp.publicKey().slice(0, 6)}`, res.hash);
}

async function usdcBalance(pub: string): Promise<string> {
  const acct = await horizon.loadAccount(pub);
  const b = acct.balances.find((x) => "asset_code" in x && x.asset_code === "USDC" && x.asset_issuer === env.USDC_ISSUER);
  return b ? b.balance : "0";
}

function signWith(kp: Keypair, unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(kp);
  return tx.toXDR();
}

async function main(): Promise<void> {
  process.stdout.write("Proofwork escrow spike — Trustless Work v1 multi-release on testnet\n");
  for (const kp of [admin, ops, funder, resolver, contributor, Keypair.fromSecret(env.DECISION_LEDGER_SECRET)]) {
    await ensureFunded(kp);
  }
  await ensureTrustline(funder);
  await ensureTrustline(admin);
  await ensureTrustline(contributor);
  process.stdout.write(`  funder USDC before: ${await usdcBalance(funder.publicKey())}\n`);

  const client = new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY);
  const escrow = new TrustlessWorkAdapter({ client, usdcIssuer: env.USDC_ISSUER, platformAdmin: admin, platformOps: ops });
  const roles = {
    funder: funder.publicKey(),
    platformAdmin: admin.publicKey(),
    platformOps: ops.publicKey(),
    disputeResolver: resolver.publicKey(),
  };

  // 1. deploy with the close milestone only
  const deploy = await escrow.buildDeploy({
    engagementId: `spike-${Date.now()}`,
    title: "Proofwork spike",
    description: "Week 1 escrow cycle verification",
    signer: funder.publicKey(),
    roles,
    closeMilestone: { description: "campaign close", amount: CLOSE_AMOUNT },
  });
  const deployed = await escrow.submit(signWith(funder, deploy.unsignedXdr));
  const contractId = deployed.contractId;
  if (!contractId) throw new Error("deploy returned no contractId");
  record("1 deploy", deployed.txHash, contractId);

  // 2. fund
  const fund = await escrow.buildFund(contractId, funder.publicKey(), FUND);
  record("2 fund", (await escrow.submit(signWith(funder, fund.unsignedXdr))).txHash, `${FUND} USDC`);
  process.stdout.write(`  escrow balance after fund: ${(await escrow.getEscrow(contractId)).balance}\n`);

  // 3. append a milestone AFTER funding — the assumption AD-2 rests on
  const appended = await escrow.appendMilestones(contractId, [
    { description: "spike submission https://x.com/example/status/1", amount: REWARD, receiver: contributor.publicKey() },
  ]);
  record("3 append milestone post-funding", appended.txHash, "AD-2 confirmed");
  const afterAppend = await escrow.getEscrow(contractId);
  process.stdout.write(`  milestones: ${afterAppend.milestones.length}\n`);
  const idx = afterAppend.milestones.length - 1;

  // 4. deliver → approve → release
  const delivered = await escrow.markDelivered(contractId, [{ index: idx, evidence: "https://x.com/example/status/1" }]);
  record("4a mark delivered", delivered[0]?.txHash ?? "");
  for (const u of await escrow.buildApprove(contractId, funder.publicKey(), [idx])) {
    record("4b approve", (await escrow.submit(signWith(funder, u.unsignedXdr))).txHash);
  }
  for (const u of await escrow.buildRelease(contractId, funder.publicKey(), [idx])) {
    record("4c release", (await escrow.submit(signWith(funder, u.unsignedXdr))).txHash, `${REWARD} USDC → contributor`);
  }
  process.stdout.write(`  contributor USDC: ${await usdcBalance(contributor.publicKey())}\n`);

  // 5. remainder back to funder: dispute the close milestone, then sweep
  for (const u of await escrow.buildDispute(contractId, funder.publicKey(), [0])) {
    record("5a dispute close milestone", (await escrow.submit(signWith(funder, u.unsignedXdr))).txHash);
  }
  const state = await escrow.getEscrow(contractId);
  process.stdout.write(`  escrow balance before sweep: ${state.balance}\n`);
  const sweep = await escrow.buildWithdrawRemaining(contractId, resolver.publicKey(), [{ address: funder.publicKey(), amount: state.balance }]);
  record("5b withdraw remaining → funder", (await escrow.submit(signWith(resolver, sweep.unsignedXdr))).txHash, "AD-4 confirmed");
  process.stdout.write(`  funder USDC after: ${await usdcBalance(funder.publicKey())}\n`);

  // 6. decision ledger commit
  const ledger = new HorizonDecisionLedger({ horizonUrl: env.HORIZON_URL, ledgerSecret: env.DECISION_LEDGER_SECRET });
  const decision: DecisionRecord = {
    v: 1,
    submission: "spike001",
    campaign: "spike",
    reviewer: funder.publicKey(),
    outcome: "PASS",
    reason: "R00_PASS",
    signals: { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true },
    appealOf: null,
    decidedAt: new Date().toISOString(),
  };
  const committed = await ledger.commit(decision);
  record("6 decision ledger", committed.txHash, `key=${committed.ledgerKey} hash=${committed.decisionHash.slice(0, 16)}…`);

  await mkdir("docs/evidence", { recursive: true });
  const md = [
    "# Escrow cycle evidence (Week 1 spike)",
    "",
    `Run: ${new Date().toISOString()}  ·  Network: Stellar testnet  ·  Escrow: Trustless Work v1 multi-release`,
    `Contract: \`${contractId}\``,
    "",
    "| Step | Tx hash | Note |",
    "|---|---|---|",
    ...evidence.map((e) => `| ${e.step} | [${e.txHash.slice(0, 12)}…](https://stellar.expert/explorer/testnet/tx/${e.txHash}) | ${e.note ?? ""} |`),
    "",
    "Decision ledger canonical JSON (sha256 = memo hash of step 6):",
    "```json",
    committed.canonicalJson,
    "```",
    "",
  ].join("\n");
  await writeFile("docs/evidence/escrow-cycle.md", md);
  process.stdout.write("\nwrote docs/evidence/escrow-cycle.md\n");
}

main().catch((e) => {
  const details = typeof e === "object" && e && "details" in e ? JSON.stringify((e as { details: unknown }).details) : "";
  process.stderr.write(`spike failed: ${e instanceof Error ? e.message : String(e)} ${details}\n`);
  process.exit(1);
});
