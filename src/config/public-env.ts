/**
 * The only environment values the browser may see. Everything here is public
 * by construction; never add a secret to this file.
 */
export const publicEnv = {
  network: "testnet" as const,
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  explorerAccountUrl: (account: string) => `https://stellar.expert/explorer/testnet/account/${account}`,
} as const;
