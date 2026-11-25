import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, payouts, profiles, submissions, xAccounts } from "@/db/schema";
import { COUNTRY_CODES, promptPath, promptTarget, safeNext } from "@/domain/profile";
import { makeTestDb } from "./db";

/**
 * Profiles: the save schema, the owner-only write, the "Later" row, the
 * public read and page (no contact field), `next` sanitizing and the
 * `needsProfile` flag at login. The routes run for real with a signed
 * session cookie against the in-process database.
 */
const world = vi.hoisted(() => ({ jar: new Map<string, string>(), conn: undefined as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (world.jar.has(name) ? { name, value: world.jar.get(name) } : undefined),
  }),
}));
vi.mock("@/db/client", () => ({
  get db() {
    return world.conn;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", "s".repeat(43));
});

const route = await import("@/app/api/profile/route");
const { default: PublicProfilePage } = await import("@/app/(public)/u/[pubkey]/page");
const { default: ProfilePage } = await import("@/app/(workspace)/profile/page");
const { ProfileForm } = await import("@/components/profile-form");
const { encodeSession } = await import("@/lib/session");
const { needsProfile } = await import("@/services/auth");
const { dismissPrompt, getOwnProfile, profileSchema, publicProfile, saveProfile } = await import("@/services/profile");

let conn: Db;
let close: () => Promise<void>;
let ME: string;
let OTHER: string;

const FULL = { displayName: "Ada", bio: "Writes threads about Soroban.", telegram: "@ada_writes", country: "TR", city: "Izmir" };

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  world.conn = conn;
  world.jar = new Map();
  ME = Keypair.random().publicKey();
  OTHER = Keypair.random().publicKey();
});

afterEach(async () => {
  await close();
});

function as(pubkey: string): void {
  world.jar.set("pw_session", encodeSession(pubkey));
}

function call(method: "PUT" | "POST", body: unknown): Promise<Response> {
  const req = new Request("https://proofwork.test/api/profile", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return method === "PUT" ? route.PUT(req) : route.POST(req);
}

async function row(pubkey: string) {
  return (await conn.select().from(profiles).where(eq(profiles.pubkey, pubkey)).limit(1))[0] ?? null;
}

describe("profileSchema", () => {
  it("accepts the full set and strips the @ from the Telegram handle", () => {
    expect(profileSchema.parse(FULL)).toEqual({ ...FULL, telegram: "ada_writes" });
    expect(profileSchema.parse({ ...FULL, telegram: "ada_writes" }).telegram).toBe("ada_writes");
    expect(profileSchema.parse({ ...FULL, telegram: "  @ada_writes  " }).telegram).toBe("ada_writes");
  });

  it("turns Windows and old Mac line breaks in a bio into plain newlines", () => {
    expect(profileSchema.parse({ displayName: "Ada", bio: "one\r\ntwo\rthree" }).bio).toBe("one\ntwo\nthree");
  });

  it("treats missing and blank optional fields as not given", () => {
    expect(profileSchema.parse({ displayName: "  Ada  ", bio: "", telegram: "  ", country: "" })).toEqual({
      displayName: "Ada",
      bio: null,
      telegram: null,
      country: null,
      city: null,
    });
  });

  it.each([
    ["an empty name", { displayName: "   " }],
    ["a 41-character name", { displayName: "a".repeat(41) }],
    ["a name with a line break", { displayName: "Ada\nLovelace" }],
    ["a 161-character bio", { displayName: "Ada", bio: "b".repeat(161) }],
    ["a 4-character handle", { displayName: "Ada", telegram: "@abcd" }],
    ["a 33-character handle", { displayName: "Ada", telegram: "a".repeat(33) }],
    ["a handle with a dot", { displayName: "Ada", telegram: "ada.writes" }],
    ["a handle starting with a digit", { displayName: "Ada", telegram: "1ada_writes" }],
    ["a handle starting with an underscore", { displayName: "Ada", telegram: "@_adawrites" }],
    ["a handle ending with an underscore", { displayName: "Ada", telegram: "ada_writes_" }],
    ["a name with a right-to-left override", { displayName: "Ada\u202Eevil" }],
    ["a name with a bidi isolate", { displayName: "\u2066Ada\u2069" }],
    ["a name of zero-width spaces", { displayName: "\u200B\u200B" }],
    // A leading or trailing BOM is whitespace to trim(); one inside the name stays and is refused.
    ["a name with a byte-order mark inside", { displayName: "Ada\uFEFFLovelace" }],
    ["a bio with a right-to-left mark", { displayName: "Ada", bio: "hello\u200Fworld" }],
    ["a city with a left-to-right embedding", { displayName: "Ada", city: "\u202AIzmir" }],
    ["a link instead of a handle", { displayName: "Ada", telegram: "https://t.me/ada_writes" }],
    ["an unassigned country code", { displayName: "Ada", country: "XX" }],
    ["a lower-case country code", { displayName: "Ada", country: "tr" }],
    ["a country name", { displayName: "Ada", country: "Turkey" }],
    ["a 61-character city", { displayName: "Ada", city: "c".repeat(61) }],
  ])("refuses %s", (_label, input) => {
    expect(profileSchema.safeParse(input).success).toBe(false);
  });

  it("keeps the edges of every limit", () => {
    expect(profileSchema.safeParse({ displayName: "a".repeat(40), bio: "b".repeat(160), telegram: "a".repeat(32), city: "c".repeat(60) }).success).toBe(true);
    expect(profileSchema.safeParse({ displayName: "A", telegram: "abcde" }).success).toBe(true);
    expect(profileSchema.safeParse({ displayName: "A", telegram: "a___1" }).success).toBe(true);
    expect(profileSchema.safeParse({ displayName: "Ada", bio: "line one\nline two" }).success).toBe(true);
  });

  it("knows every ISO 3166-1 alpha-2 code, each with a display name", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    for (const code of COUNTRY_CODES) expect(names.of(code), code).toBeTruthy();
  });
});

describe("saveProfile and dismissPrompt", () => {
  it("writes the actor's row only, whatever the input names", async () => {
    await saveProfile({ ...FULL, pubkey: OTHER } as typeof FULL, { pubkey: ME }, conn);
    expect(await row(OTHER)).toBeNull();
    expect(await row(ME)).toMatchObject({ displayName: "Ada", telegram: "ada_writes", country: "TR", city: "Izmir" });
  });

  it("updates in place on a second save", async () => {
    await saveProfile(FULL, { pubkey: ME }, conn);
    const saved = await saveProfile({ displayName: "Ada L." }, { pubkey: ME }, conn);
    expect(saved).toMatchObject({ displayName: "Ada L.", bio: null, telegram: null, country: null, city: null });
    expect(await conn.select().from(profiles)).toHaveLength(1);
  });

  it("refuses an actor that is not a wallet key", async () => {
    await expect(saveProfile(FULL, { pubkey: "not-a-key" }, conn)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(dismissPrompt({ pubkey: "" }, conn)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("Later stores a row with no name and leaves a saved profile alone", async () => {
    await dismissPrompt({ pubkey: ME }, conn);
    const r = await row(ME);
    expect(r).toMatchObject({ displayName: null, telegram: null });
    expect(r?.promptedAt).toBeInstanceOf(Date);

    await saveProfile(FULL, { pubkey: OTHER }, conn);
    await dismissPrompt({ pubkey: OTHER }, conn);
    expect((await getOwnProfile(OTHER, conn))?.displayName).toBe("Ada");
  });
});

describe("needsProfile at login", () => {
  it("is true until the wallet saves or skips, then false for good", async () => {
    expect(await needsProfile(ME, conn)).toBe(true);
    await dismissPrompt({ pubkey: ME }, conn);
    expect(await needsProfile(ME, conn)).toBe(false);
    expect(await needsProfile(OTHER, conn)).toBe(true);
    await saveProfile(FULL, { pubkey: OTHER }, conn);
    expect(await needsProfile(OTHER, conn)).toBe(false);
  });
});

describe("safeNext", () => {
  it.each([
    ["/c/launch-week?x=connected#submit", "/c/launch-week?x=connected#submit"],
    ["/", "/"],
    ["//evil.com", "/"],
    ["//evil.com/path", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/\\evil.com", "/"],
    ["/ok\nSet-Cookie:x", "/"],
    ["/.//evil.com", "/"],
    ["/..//evil.com", "/"],
    ["/%2e//evil.com", "/"],
    ["/a/../c/x?y=1#h", "/c/x?y=1#h"],
    ["", "/"],
  ])("%j → %j", (raw, out) => {
    expect(safeNext(raw)).toBe(out);
  });

  it("refuses non-strings and very long values", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(["/a"])).toBe("/");
    expect(safeNext("/" + "a".repeat(2048))).toBe("/");
  });

  it("round-trips the prompt link the wallet button builds", () => {
    const next = new URL(promptPath("/c/launch-week?x=connected"), "https://proofwork.test").searchParams.get("next");
    expect(safeNext(next)).toBe("/c/launch-week?x=connected");
  });
});

describe("promptTarget", () => {
  it("sends a wallet that needs a profile to the prompt with its full location", () => {
    expect(promptTarget(true, "/c/x", "?y=1", "#a")).toBe("/profile?next=%2Fc%2Fx%3Fy%3D1%23a");
  });

  it("stays put when no prompt is due or the prompt is already open", () => {
    expect(promptTarget(false, "/c/x", "?y=1", "#a")).toBeNull();
    expect(promptTarget(true, "/profile", "", "")).toBeNull();
  });
});

describe("/profile", () => {
  async function page(next: string | string[] | undefined): Promise<ReactElement> {
    return (await ProfilePage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) })) as ReactElement;
  }

  /** The ProfileForm element the page hands its props to. */
  function formOf(tree: ReactElement): { next: string | null; saved: boolean } {
    const found: Array<{ next: string | null; saved: boolean }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object" && "props" in node) {
        const el = node as ReactElement<{ children?: unknown; next: string | null; saved: boolean }>;
        if (el.type === ProfileForm) found.push(el.props);
        walk(el.props.children);
      }
    };
    walk(tree);
    expect(found).toHaveLength(1);
    return found[0] as { next: string | null; saved: boolean };
  }

  it("hands the form a sanitized next: / for an off-site value, null for a repeated one or none", async () => {
    as(ME);
    expect(formOf(await page("//evil.com")).next).toBe("/");
    expect(formOf(await page(["/a", "/b"])).next).toBeNull();
    expect(formOf(await page(undefined)).next).toBeNull();
    expect(formOf(await page("/c/x?y=1")).next).toBe("/c/x?y=1");
  });

  it("offers Later only while no name is saved", async () => {
    as(ME);
    expect(renderToStaticMarkup(await page("/c/x"))).toContain(">Later<");
    await dismissPrompt({ pubkey: ME }, conn);
    expect(renderToStaticMarkup(await page("/c/x"))).toContain(">Later<");
    await saveProfile(FULL, { pubkey: ME }, conn);
    expect(renderToStaticMarkup(await page("/c/x"))).not.toContain(">Later<");
  });
});

describe("publicProfile", () => {
  /** One campaign per submission: a wallet submits once to each campaign. */
  async function campaign(id: string): Promise<void> {
    await conn.insert(campaigns).values({
      id,
      slug: id === "c_s1" ? "launch-week" : `slug-${id}`,
      title: `Campaign ${id}`,
      brief: "A brief long enough to pass validation.",
      rewardAmount: "5",
      budget: "100",
      deadlineAt: new Date(Date.now() + 86_400_000),
      fundedAt: new Date(),
      funderPubkey: "G_FUNDER",
      disputeResolverPubkey: "G_DR",
    });
  }

  async function submission(id: string, contributor: string, status: typeof submissions.$inferInsert.status): Promise<void> {
    await campaign(`c_${id}`);
    await conn.insert(submissions).values({ id, shortId: id, campaignId: `c_${id}`, contributorPubkey: contributor, workUrl: `https://x.com/ada/status/${id.replace(/\D/g, "")}`, status });
  }

  it("is null for a wallet without a row or without a name", async () => {
    expect(await publicProfile(ME, conn)).toBeNull();
    await dismissPrompt({ pubkey: ME }, conn);
    expect(await publicProfile(ME, conn)).toBeNull();
  });

  it("returns the public fields, the X link and approved work and payouts, never a contact field", async () => {
    await saveProfile(FULL, { pubkey: ME }, conn);
    await conn.insert(xAccounts).values({ pubkey: ME, xUserId: "1234567890" });
    await submission("s1", ME, "paid");
    await submission("s2", ME, "decided");
    await submission("s3", ME, "rejected");
    await submission("s4", ME, "pending");
    await submission("s5", OTHER, "paid");
    await conn.insert(payouts).values([
      { id: "p1", submissionId: "s1", amount: "5", status: "released", releaseTxHash: "a".repeat(64), releasedAt: new Date() },
      { id: "p2", submissionId: "s2", amount: "5", status: "approved" },
      { id: "p5", submissionId: "s5", amount: "5", status: "released", releaseTxHash: "b".repeat(64), releasedAt: new Date() },
    ]);

    const p = await publicProfile(ME, conn);
    expect(p).not.toBeNull();
    expect(Object.keys(p ?? {}).sort()).toEqual(["approvedCount", "bio", "displayName", "paidAmount", "payoutCount", "payouts", "pubkey", "submissions", "xUrl"]);
    expect(p).toMatchObject({ approvedCount: 2, payoutCount: 1, paidAmount: "5.0000000" });
    expect(p).toMatchObject({ displayName: "Ada", bio: FULL.bio, xUrl: "https://x.com/i/user/1234567890" });
    expect(p?.submissions.map((s) => s.workUrl).sort()).toEqual(["https://x.com/ada/status/1", "https://x.com/ada/status/2"]);
    expect(p?.payouts).toEqual([expect.objectContaining({ releaseTxHash: "a".repeat(64), campaignSlug: "launch-week" })]);
    const json = JSON.stringify(p);
    expect(json).not.toContain("ada_writes");
    expect(json).not.toContain("Izmir");
    expect(json).not.toContain('"TR"');
  });

  it("counts every approved post and payout past the listed ones, and shows payouts net of fee", async () => {
    await saveProfile({ displayName: "Ada" }, { pubkey: ME }, conn);
    for (let i = 1; i <= 52; i++) {
      await submission(`s${i}`, ME, "paid");
      await conn.insert(payouts).values({ id: `p${i}`, submissionId: `s${i}`, amount: "5", status: "released", releaseTxHash: String(i).padStart(64, "0"), releasedAt: new Date() });
    }
    const p = await publicProfile(ME, conn);
    expect(p?.submissions).toHaveLength(50);
    expect(p?.payouts).toHaveLength(50);
    expect(p).toMatchObject({ approvedCount: 52, payoutCount: 52, paidAmount: "260.0000000" });
    const html = renderToStaticMarkup((await PublicProfilePage({ params: Promise.resolve({ pubkey: ME }) })) as ReactElement);
    expect(html).toContain(">52<");
    // 5 USDC leaves the escrow, 4.985 arrives; 260 in total arrives as 259.22.
    expect(html).toContain("+4.985");
    expect(html).toContain("259.22");
  });

  it("has no X link when no account is connected", async () => {
    await saveProfile({ displayName: "Ada" }, { pubkey: ME }, conn);
    expect((await publicProfile(ME, conn))?.xUrl).toBeNull();
  });
});

describe("/u/[pubkey]", () => {
  async function render(pubkey: string): Promise<string> {
    const tree = (await PublicProfilePage({ params: Promise.resolve({ pubkey }) })) as ReactElement;
    return renderToStaticMarkup(tree);
  }

  it("shows the name and bio, and neither the Telegram handle nor the city", async () => {
    await saveProfile(FULL, { pubkey: ME }, conn);
    const html = await render(ME);
    expect(html).toContain("Ada");
    expect(html).toContain(FULL.bio);
    expect(html).not.toContain("ada_writes");
    expect(html).not.toContain("Izmir");
  });

  it("is not found for a skipped prompt, an unknown wallet or a malformed key", async () => {
    await dismissPrompt({ pubkey: ME }, conn);
    await expect(render(ME)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render(OTHER)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("not-a-key")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/api/profile", () => {
  it("answers 401 without a session", async () => {
    expect((await call("PUT", FULL)).status).toBe(401);
    expect((await call("POST", { action: "later" })).status).toBe(401);
  });

  it("saves the session wallet's row even when the body names another wallet", async () => {
    as(ME);
    const res = await call("PUT", { ...FULL, pubkey: OTHER });
    expect(res.status).toBe(200);
    expect(await row(OTHER)).toBeNull();
    expect(await row(ME)).toMatchObject({ displayName: "Ada", telegram: "ada_writes" });
    expect(await getOwnProfile(ME, conn)).toMatchObject({ telegram: "ada_writes", city: "Izmir" });
  });

  it("answers 400 with the field issues", async () => {
    as(ME);
    const res = await call("PUT", { displayName: "", telegram: "x" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { issues: Array<{ path: string[] }> } };
    expect(body.details.issues.map((i) => i.path[0]).sort()).toEqual(["displayName", "telegram"]);
    expect(await row(ME)).toBeNull();
  });

  it("records Later once and refuses any other action", async () => {
    as(ME);
    expect((await call("POST", { action: "later" })).status).toBe(200);
    expect(await row(ME)).toMatchObject({ displayName: null });
    expect((await call("POST", { action: "delete" })).status).toBe(400);
  });

  it("rate limits writes per session wallet", async () => {
    as(ME);
    for (let i = 0; i < 20; i++) expect((await call("PUT", FULL)).status).toBe(200);
    expect((await call("PUT", FULL)).status).toBe(429);
  });
});
