import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/review" }));
const session = vi.hoisted(() => ({ user: null as { pubkey: string; roles: Set<string> } | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/wallet/kit", () => ({ login: async () => undefined, logout: async () => undefined }));
vi.mock("@/lib/current-user", () => ({ currentUser: async () => session.user }));

const { WalletButton } = await import("@/components/wallet-button");
const { WorkspaceNav } = await import("@/components/workspace-nav");
const { default: WorkspaceLayout } = await import("@/app/(workspace)/layout");
const { default: PublicLayout } = await import("@/app/(public)/layout");
const { Button } = await import("@/components/ui/button");

const WALLET = "GDXGQ7VJ2Y6XJ3KZ5L4M8N2P7R9S3T6U1W4X8Y2Z5A7B9C3D6EQR4F2A";

async function renderWorkspace(): Promise<string> {
  const tree = (await WorkspaceLayout({ children: createElement("p", null, "page body") })) as ReactElement;
  return renderToStaticMarkup(tree);
}

async function renderPublic(): Promise<string> {
  const tree = (await PublicLayout({ children: createElement("p", null, "page body") })) as ReactElement;
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  nav.pathname = "/review";
  session.user = null;
});

describe("wallet control", () => {
  it("offers Connect wallet when signed out", () => {
    const html = renderToStaticMarkup(createElement(WalletButton, { pubkey: null }));
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("GDXG…4F2A");
  });

  it("shows the short key, with the full address as the accessible name, when signed in", () => {
    const html = renderToStaticMarkup(createElement(WalletButton, { pubkey: WALLET }));
    expect(html).toContain("GDXG…4F2A");
    expect(html).toContain(`aria-label="Wallet ${WALLET}"`);
    expect(html).not.toContain("Connect wallet");
  });
});

describe("workspace nav", () => {
  it("shows only the Public group for a wallet with no roles", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { funder: false, reviewer: false, variant: "side" }));
    expect(html).toContain("Public");
    expect(html).not.toContain("Workspace");
    expect(html).not.toContain("Campaigns");
    expect(html).not.toContain("Review");
  });

  it("shows only the items for the roles held", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { funder: true, reviewer: false, variant: "side" }));
    expect(html).toContain("Campaigns");
    expect(html).not.toContain(">Review<");
  });

  it("marks the item that owns the current path", () => {
    nav.pathname = "/campaigns/try-proofwork";
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { funder: true, reviewer: true, variant: "side" }));
    expect(html).toMatch(/href="\/campaigns" aria-current="page"/);
    expect(html).not.toMatch(/href="\/review" aria-current="page"/);
  });
});

describe("workspace shell", () => {
  it("puts the sidebar behind lg and the top bar below it", async () => {
    session.user = { pubkey: WALLET, roles: new Set(["reviewer"]) };
    const html = await renderWorkspace();
    expect(html).toMatch(/<aside class="[^"]*\bhidden\b[^"]*\blg:flex\b/);
    expect(html).toMatch(/<header class="[^"]*\blg:hidden\b/);
    expect(html).toContain("page body");
  });

  it("shows no workspace items for a signed-in wallet with zero roles", async () => {
    session.user = { pubkey: WALLET, roles: new Set() };
    const html = await renderWorkspace();
    expect(html).not.toContain("Workspace");
    expect(html).not.toContain(">Campaigns<");
    expect(html).toContain("Public");
  });
});

describe("public shell", () => {
  it("shows no role links when signed out", async () => {
    const html = await renderPublic();
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain('href="/review"');
    expect(html).toContain("Connect wallet");
    expect(html).toContain("page body");
  });

  it("sends a signed-out visitor on the landing page into the app instead of asking for a wallet", async () => {
    nav.pathname = "/";
    const html = await renderPublic();
    expect(html).toMatch(/<a href="\/campaigns"[^>]*>Launch app/);
    expect(html).not.toContain("Connect wallet");
  });

  it("keeps Connect wallet on a campaign page so a contributor can sign in there", async () => {
    nav.pathname = "/c/try-proofwork";
    const html = await renderPublic();
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("Launch app");
  });

  it("shows only Review, and no Home item, for a reviewer", async () => {
    session.user = { pubkey: WALLET, roles: new Set(["reviewer"]) };
    const html = await renderPublic();
    expect(html).toContain('href="/review"');
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain(">Home<");
  });

  it("shows no nav links for a wallet with zero roles", async () => {
    session.user = { pubkey: WALLET, roles: new Set() };
    const html = await renderPublic();
    expect(html).not.toContain("<nav");
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain('href="/review"');
  });
});

describe("button", () => {
  it("is disabled, aria-busy and shows the busy label while busy", () => {
    const html = renderToStaticMarkup(createElement(Button, { busy: true, busyLabel: "Committing on-chain…" }, "Record PASS on-chain"));
    expect(html).toMatch(/<button[^>]*\bdisabled=""/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Committing on-chain…");
    expect(html).not.toContain("Record PASS on-chain");
  });

  it("has neither attribute when not busy", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Record PASS on-chain"));
    expect(html).not.toMatch(/<button[^>]*\bdisabled=""/);
    expect(html).not.toContain("aria-busy");
    expect(html).toContain("Record PASS on-chain");
  });
});
