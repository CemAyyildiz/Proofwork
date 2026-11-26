"use client";

import type { StellarWalletsKit as Kit } from "@creit.tech/stellar-wallets-kit/sdk";
import { Networks, type ModuleInterface, type SwkAppTheme } from "@creit.tech/stellar-wallets-kit/types";
import { publicEnv } from "@/config/public-env";

/**
 * Browser-only wallet layer. The kit is a static singleton; we initialise it
 * once, on the network the app was built for, with Varial (formerly Freighter), the wallet contributors will have.
 * Secret keys never exist in this process.
 *
 * The kit is loaded on the first wallet action, never with the page: on
 * import it writes its theme variables onto <html>, and a page that loads it
 * before hydration no longer matches the server's <html>.
 */
let loaded: Promise<typeof Kit> | null = null;

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

function kit(): Promise<typeof Kit> {
  loaded ??= (async () => {
    const [{ StellarWalletsKit }, { VarialModule, VARIAL_ID }] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/varial"),
    ]);
    const modules: ModuleInterface[] = [new VarialModule()];
    const projectId = publicEnv.walletConnectProjectId;
    if (projectId) {
      // The Varial mobile app connects only over WalletConnect, also from its own in-app browser.
      // Loaded only when configured: it pulls in Reown AppKit.
      const { WalletConnectModule, WalletConnectTargetChain } = await import("@creit.tech/stellar-wallets-kit/modules/wallet-connect");
      const origin = window.location.origin;
      modules.push(
        new WalletConnectModule({
          projectId,
          metadata: { name: "Proofwork", description: "Human-verified bounties settled on Stellar", url: origin, icons: [`${origin}/icon.svg`] },
          allowedChains: [publicEnv.isMainnet ? WalletConnectTargetChain.PUBLIC : WalletConnectTargetChain.TESTNET],
        }),
      );
    }
    StellarWalletsKit.init({
      modules,
      network: publicEnv.isMainnet ? Networks.PUBLIC : Networks.TESTNET,
      theme: THEME,
      authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
    });
    // The kit restores its selected wallet from localStorage. A browser that signed in
    // before the rename still holds "freighter", which matches no module, and every
    // signature then failed with "Please set the wallet first". A stored id that matches
    // one of the modules (a phone that connected over WalletConnect) is kept.
    try {
      void StellarWalletsKit.selectedModule;
    } catch {
      StellarWalletsKit.setWallet(VARIAL_ID);
    }
    return StellarWalletsKit;
  })().catch((e: unknown) => {
    // A failed load (a chunk that did not arrive) is retried on the next action.
    loaded = null;
    throw e;
  });
  return loaded;
}

export async function connectWallet(): Promise<string> {
  const StellarWalletsKit = await kit();
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
  await (await kit()).disconnect();
}

export async function signMessage(address: string, message: string): Promise<string> {
  const { signedMessage } = await (await kit()).signMessage(message, {
    address,
    networkPassphrase: publicEnv.networkPassphrase,
  });
  return signedMessage;
}

export async function signTransaction(address: string, unsignedXdr: string): Promise<string> {
  const { signedTxXdr } = await (await kit()).signTransaction(unsignedXdr, {
    address,
    networkPassphrase: publicEnv.networkPassphrase,
  });
  return signedTxXdr;
}

export async function signAuthEntry(address: string, authEntry: string): Promise<string> {
  const { signedAuthEntry } = await (await kit()).signAuthEntry(authEntry, {
    address,
    networkPassphrase: publicEnv.networkPassphrase,
  });
  return signedAuthEntry;
}

export interface LoginResult {
  pubkey: string;
  roles: string[];
  /** The wallet has never been asked for a profile: the caller sends it to the prompt. */
  needsProfile: boolean;
}

/** Full login: connect → challenge → sign → verify. Returns the session identity. */
export async function login(): Promise<LoginResult> {
  const pubkey = await connectWallet();
  const challenge = await post<{ nonce: string; message: string }>("/api/auth/challenge", { pubkey });
  const signature = await signMessage(pubkey, challenge.message);
  return post<LoginResult>("/api/auth/verify", { pubkey, nonce: challenge.nonce, signature });
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
  // An error page from a proxy or the platform is not JSON: report the status instead of a parse error.
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || json === null) throw new Error(json?.message ?? `request failed (${res.status})`);
  return json;
}
