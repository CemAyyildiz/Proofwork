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
// No database here: none of these wallets owns a funded campaign. The lookup itself is covered in access.test.ts.
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/services/access", () => ({
  campaignsNav: async (user: { roles: Set<string> }) => (user.roles.has("funder") ? "manage" : "request"),
  adminNav: async (user: { roles: Set<string> }) => user.roles.has("ops"),
}));

const { WalletButton } = await import("@/components/wallet-button");
const { WorkspaceMenu, WorkspaceNav } = await import("@/components/workspace-nav");
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
  it("shows only the Public group when signed out", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { campaigns: null, reviewer: false, admin: false, variant: "side" }));
    expect(html).toContain("Public");
    expect(html).not.toContain("Workspace");
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain("Review");
  });

  it("shows only the items for the roles held", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { campaigns: "manage", reviewer: false, admin: false, variant: "side" }));
    expect(html).toContain("Campaigns");
    expect(html).not.toContain("Run a campaign");
    expect(html).not.toContain(">Review<");
  });

  it("labels the campaigns item Run a campaign for a wallet that would find the request form there", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { campaigns: "request", reviewer: false, admin: false, variant: "side" }));
    expect(html).toMatch(/href="\/campaigns"[^>]*>.*?Run a campaign<\/a>/);
    expect(html).not.toContain("Campaigns");
  });

  it("marks the item that owns the current path", () => {
    nav.pathname = "/campaigns/try-proofwork";
    const html = renderToStaticMarkup(createElement(WorkspaceNav, { campaigns: "manage", reviewer: true, admin: false, variant: "side" }));
    expect(html).toMatch(/href="\/campaigns" aria-current="page"/);
    expect(html).not.toMatch(/href="\/review" aria-current="page"/);
  });
});

describe("workspace menu below lg", () => {
  it("renders a closed Menu button that controls a hidden panel", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceMenu, { campaigns: "manage", reviewer: true, admin: true }));
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Menu"[^>]*>.*Menu<\/span><\/button>/);
    expect(id).toBeTruthy();
    expect(html).toMatch(/^<nav aria-label="Main">/);
    expect(html).toMatch(new RegExp(`<div id="${id}" hidden=""`));
  });

  it("lists every item the roles allow, in the sidebar's groups, with the current page marked", () => {
    nav.pathname = "/admin";
    const html = renderToStaticMarkup(createElement(WorkspaceMenu, { campaigns: "manage", reviewer: true, admin: true }));
    for (const href of ["/campaigns", "/review", "/admin", "/explore", "/"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("Workspace");
    expect(html).toContain("Public");
    expect(html).toMatch(/href="\/admin" aria-current="page"/);
    expect(html).not.toMatch(/href="\/review" aria-current="page"/);
  });

  it("shows only the Public group when signed out", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceMenu, { campaigns: null, reviewer: false, admin: false }));
    expect(html).toContain('href="/explore"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Workspace");
  });

  it("leaves out what the wallet cannot use", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceMenu, { campaigns: "request", reviewer: false, admin: false }));
    expect(html).toMatch(/href="\/campaigns"[^>]*>.*?Run a campaign<\/a>/);
    expect(html).not.toContain('href="/review"');
    expect(html).not.toContain('href="/admin"');
  });
});

describe("workspace shell", () => {
  it("puts the sidebar behind lg and the top bar below it", async () => {
    session.user = { pubkey: WALLET, roles: new Set(["reviewer"]) };
    const html = await renderWorkspace();
    expect(html).toMatch(/<aside class="[^"]*\bhidden\b[^"]*\blg:flex\b/);
    expect(html).toMatch(/<header class="[^"]*\blg:hidden\b/);
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(header).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls=/);
    expect(header).not.toContain("overflow-x-auto");
    expect(html).toContain("page body");
  });

  it("links a signed-in wallet with zero roles to the request form, and to nothing else in the workspace", async () => {
    session.user = { pubkey: WALLET, roles: new Set() };
    const html = await renderWorkspace();
    expect(html).toContain("Workspace");
    expect(html).toMatch(/href="\/campaigns"[^>]*>.*?Run a campaign<\/a>/);
    expect(html).not.toContain("Campaigns");
    expect(html).not.toContain('href="/review"');
    expect(html).not.toContain('href="/admin"');
    expect(html).toContain("Public");
  });

  it("shows no workspace items when signed out", async () => {
    const html = await renderWorkspace();
    expect(html).not.toContain("Workspace");
    expect(html).not.toContain('href="/campaigns"');
  });

  it("labels the item Campaigns for a funder", async () => {
    session.user = { pubkey: WALLET, roles: new Set(["funder"]) };
    const html = await renderWorkspace();
    expect(html).toMatch(/href="\/campaigns"[^>]*>.*?Campaigns<\/a>/);
    expect(html).not.toContain("Run a campaign");
  });
});

describe("public shell", () => {
  it("shows no role links, only Explore, when signed out", async () => {
    const html = await renderPublic();
    expect(html).toContain('href="/explore"');
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain('href="/review"');
    expect(html).toContain("Connect wallet");
    expect(html).toContain("page body");
  });

  it("sends a signed-out visitor on the landing page into the app instead of asking for a wallet", async () => {
    nav.pathname = "/";
    const html = await renderPublic();
    expect(html).toMatch(/<a href="\/explore"[^>]*>Launch app/);
    expect(html).not.toContain("Connect wallet");
  });

  it("keeps Connect wallet on a campaign page so a contributor can sign in there", async () => {
    nav.pathname = "/c/try-proofwork";
    const html = await renderPublic();
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("Launch app");
  });

  it("shows Review and Run a campaign, and no Home item, for a reviewer", async () => {
    session.user = { pubkey: WALLET, roles: new Set(["reviewer"]) };
    const html = await renderPublic();
    expect(html).toContain('href="/review"');
    expect(html).toMatch(/href="\/campaigns"[^>]*>.*?Run a campaign<\/a>/);
    expect(html).not.toContain(">Home<");
  });

  it("shows Explore and Run a campaign for a wallet with zero roles", async () => {
    session.user = { pubkey: WALLET, roles: new Set() };
    const html = await renderPublic();
    expect(html).toContain('href="/explore"');
    expect(html).toMatch(/href="\/campaigns"[^>]*>.*?Run a campaign<\/a>/);
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
