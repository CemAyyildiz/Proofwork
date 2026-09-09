"use client";

import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { publicEnv } from "@/config/public-env";

/**
 * Browser-only wallet layer. The kit is a static singleton; we initialise it
 * once, testnet only, Freighter first (it is what contributors will have).
 * Secret keys never exist in this process.
 */
let initialised = false;

function ensureInit(): void {
  if (initialised) return;
  StellarWalletsKit.init({
    modules: [new FreighterModule()],
    network: Networks.TESTNET,
    authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
  });
  initialised = true;
}

export async function connectWallet(): Promise<string> {
  ensureInit();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export async function disconnectWallet(): Promise<void> {
  ensureInit();
  await StellarWalletsKit.disconnect();
}

export async function signMessage(address: string, message: string): Promise<string> {
  ensureInit();
  const { signedMessage } = await StellarWalletsKit.signMessage(message, {
    address,
    networkPassphrase: publicEnv.networkPassphrase,
  });
  return signedMessage;
}

export async function signTransaction(address: string, unsignedXdr: string): Promise<string> {
  ensureInit();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(unsignedXdr, {
    address,
    networkPassphrase: publicEnv.networkPassphrase,
  });
  return signedTxXdr;
}

/** Full login: connect → challenge → sign → verify. Returns the session identity. */
export async function login(): Promise<{ pubkey: string; roles: string[] }> {
  const pubkey = await connectWallet();
  const challenge = await post<{ nonce: string; message: string }>("/api/auth/challenge", { pubkey });
  const signature = await signMessage(pubkey, challenge.message);
  return post<{ pubkey: string; roles: string[] }>("/api/auth/verify", { pubkey, nonce: challenge.nonce, signature });
}

export async function logout(): Promise<void> {
  await post("/api/auth/logout", {});
  await disconnectWallet().catch(() => undefined);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(json.message ?? `request failed (${res.status})`);
  return json;
}
