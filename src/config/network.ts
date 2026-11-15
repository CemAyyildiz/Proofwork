/**
 * The two Stellar networks Proofwork can run on, and the public facts that
 * differ between them. Nothing here is secret; the browser reads it too.
 *
 * Mainnet facts read on 2026-11-15:
 *   - USDC issuer GA5Z…KZVN has home_domain circle.com on horizon.stellar.org
 *   - Trustless Work serves the same Core API on api.trustlesswork.com
 *     (`/docs-json` answers 200, reads without a key answer 401)
 */
export type StellarNetwork = "testnet" | "mainnet";

export interface NetworkFacts {
  network: StellarNetwork;
  /** "Stellar testnet" / "Stellar mainnet", for sentences. */
  name: string;
  passphrase: string;
  horizonUrl: string;
  usdcIssuer: string;
  /** Trustless Work Core API host. */
  twBaseUrl: string;
  /** Path segment of stellar.expert for this network. */
  explorerSlug: "testnet" | "public";
  /** Friendbot creates accounts on testnet only. */
  friendbotUrl: string | null;
}

export const NETWORKS: Record<StellarNetwork, NetworkFacts> = {
  testnet: {
    network: "testnet",
    name: "Stellar testnet",
    passphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    twBaseUrl: "https://dev.api.trustlesswork.com",
    explorerSlug: "testnet",
    friendbotUrl: "https://friendbot.stellar.org",
  },
  mainnet: {
    network: "mainnet",
    name: "Stellar mainnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    twBaseUrl: "https://api.trustlesswork.com",
    explorerSlug: "public",
    friendbotUrl: null,
  },
};

/** An unset or blank value means testnet; anything else must name a network. */
export function parseNetwork(value: string | undefined): StellarNetwork {
  const v = value?.trim() ?? "";
  if (v === "" || v === "testnet") return "testnet";
  if (v === "mainnet") return "mainnet";
  throw new Error(`Invalid NEXT_PUBLIC_STELLAR_NETWORK "${v}": use "testnet" or "mainnet"`);
}

export interface Explorer {
  tx: (hash: string) => string;
  account: (account: string) => string;
  contract: (contractId: string) => string;
}

/** stellar.expert links for one network. Recorded testnet evidence keeps its testnet links on any deployment. */
export function explorerFor(network: StellarNetwork): Explorer {
  const base = `https://stellar.expert/explorer/${NETWORKS[network].explorerSlug}`;
  return {
    tx: (hash) => `${base}/tx/${hash}`,
    account: (account) => `${base}/account/${account}`,
    contract: (contractId) => `${base}/contract/${contractId}`,
  };
}
