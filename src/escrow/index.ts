import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { env } from "@/config/env";
import { HorizonDecisionLedger } from "@/ledger/decision-ledger";
import type { EscrowPort } from "./port";
import { TrustlessWorkAdapter } from "./trustless-work/adapter";
import { TrustlessWorkClient } from "./trustless-work/client";

/**
 * Composition root for the on-chain side. Server keys are instantiated once
 * here and handed to adapters as Keypair objects; the secret strings are never
 * passed around.
 */
const platformAdmin = Keypair.fromSecret(env.PLATFORM_ADMIN_SECRET);
const platformOps = Keypair.fromSecret(env.PLATFORM_OPS_SECRET);

export const escrow: EscrowPort = new TrustlessWorkAdapter({
  client: new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY),
  usdcIssuer: env.USDC_ISSUER,
  platformAdmin,
  platformOps,
});

export const ledger = new HorizonDecisionLedger({
  horizonUrl: env.HORIZON_URL,
  ledgerSecret: env.DECISION_LEDGER_SECRET,
});

export const platformKeys = {
  admin: platformAdmin.publicKey(),
  ops: platformOps.publicKey(),
  ledger: ledger.publicKey,
} as const;
