import { explorerFor, NETWORKS, parseNetwork } from "./network";

/**
 * The only environment values the browser may see. Everything here is public
 * by construction; never add a secret to this file.
 *
 * The network is fixed when the app is built: Next.js inlines
 * NEXT_PUBLIC_STELLAR_NETWORK into the bundle. The server's STELLAR_NETWORK
 * must name the same network (checked in `env.ts`).
 */
const facts = NETWORKS[parseNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK)];
const explorer = explorerFor(facts.network);

export const publicEnv = {
  network: facts.network,
  isMainnet: facts.network === "mainnet",
  /** "Stellar testnet" / "Stellar mainnet". */
  networkName: facts.name,
  networkPassphrase: facts.passphrase,
  horizonUrl: facts.horizonUrl,
  /** Null on mainnet: accounts there are funded by their owners. */
  friendbotUrl: facts.friendbotUrl,
  usdcIssuer: facts.usdcIssuer,
  explorerTxUrl: explorer.tx,
  explorerAccountUrl: explorer.account,
  explorerContractUrl: explorer.contract,
} as const;
