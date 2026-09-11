import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { env } from "@/config/env";
import { HorizonDecisionLedger } from "@/ledger/decision-ledger";
import type { EscrowPort } from "./port";
import { TrustlessWorkAdapter } from "./trustless-work/adapter";
import { TrustlessWorkClient } from "./trustless-work/client";

/**
 * Composition root for the on-chain side. Everything is created on first use
 * so importing this module never reads the environment (build safety).
 * Server keys are held as Keypair objects; the secret strings never travel.
 */
interface Wiring {
  escrow: EscrowPort;
  ledger: HorizonDecisionLedger;
  platformKeys: { admin: string; ops: string; ledger: string };
}

let wiring: Wiring | undefined;

function wire(): Wiring {
  const platformAdmin = Keypair.fromSecret(env.PLATFORM_ADMIN_SECRET);
  const platformOps = Keypair.fromSecret(env.PLATFORM_OPS_SECRET);
  const ledger = new HorizonDecisionLedger({ horizonUrl: env.HORIZON_URL, ledgerSecret: env.DECISION_LEDGER_SECRET });
  return {
    escrow: new TrustlessWorkAdapter({
      client: new TrustlessWorkClient(env.TW_BASE_URL, env.TW_API_KEY),
      usdcIssuer: env.USDC_ISSUER,
      platformAdmin,
      platformOps,
    }),
    ledger,
    platformKeys: { admin: platformAdmin.publicKey(), ops: platformOps.publicKey(), ledger: ledger.publicKey },
  };
}

export function getEscrow(): EscrowPort {
  return (wiring ??= wire()).escrow;
}
export function getLedger(): HorizonDecisionLedger {
  return (wiring ??= wire()).ledger;
}
export function getPlatformKeys(): Wiring["platformKeys"] {
  return (wiring ??= wire()).platformKeys;
}
