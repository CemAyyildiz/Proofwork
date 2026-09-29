"use client";

import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { Networks, type SwkAppTheme } from "@creit.tech/stellar-wallets-kit/types";
import { publicEnv } from "@/config/public-env";

/**
 * Browser-only wallet layer. The kit is a static singleton; we initialise it
 * once, testnet only, Freighter first (it is what contributors will have).
 * Secret keys never exist in this process.
 */
let initialised = false;

/** The kit's modal in Proofwork's dark tokens, so it doesn't flash a white sheet over the page. */
const THEME: SwkAppTheme = {
  background: "#181818",
  "background-secondary": "#0c0c0c",
  "foreground-strong": "#f2f1ec",
  foreground: "#f2f1ec",
  "foreground-secondary": "#c9c7be",
  primary: "#fdda24",
  "primary-foreground": "#0f0f0f",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "#1f1f1f",
  light: "#181818",
  "light-gray": "#5a5a57",
  gray: "#8a8a86",
  danger: "#f87171",
  border: "rgba(255, 255, 255, 0.12)",
  shadow: "0 24px 48px -12px rgba(0, 0, 0, 0.6)",
  "border-radius": "0.75rem",
  "font-family": "inherit",
};

/** The visitor closed the wallet modal: not an error, the button just resets. */
export class WalletCancelled extends Error {
  constructor() {
    super("wallet connection cancelled");
    this.name = "WalletCancelled";
  }
}

function ensureInit(): void {
  if (initialised) return;
  StellarWalletsKit.init({
    modules: [new FreighterModule()],
    network: Networks.TESTNET,
    theme: THEME,
    authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
  });
  initialised = true;
}

export async function connectWallet(): Promise<string> {
  ensureInit();
  try {
    const { address } = await StellarWalletsKit.authModal();
    return address;
  } catch (e) {
    // The kit rejects with a plain `{ code: -1 }` object when the modal is closed.
    if (typeof e === "object" && e !== null && "code" in e && e.code === -1) throw new WalletCancelled();
    throw e instanceof Error ? e : new Error(walletMessage(e));
  }
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

function walletMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") return e.message;
  return "wallet error";
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
