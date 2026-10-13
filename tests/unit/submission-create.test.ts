import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, escrowOps, submissions, xAccounts, type EscrowOp } from "@/db/schema";
import { STALE_SUBMITTED_MS } from "@/services/escrow-ops";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { createSubmission, type FundingSourceReader, type PostAuthorReader, type TrustlineReader } from "@/services/submission";
import { XApi } from "@/x/api";
import { FakeX } from "@/x/fake";
import { makeTestDb } from "./db";
import { fakeFetch, type FakeReply } from "./fake-fetch";

const CONTRIBUTOR = { pubkey: "GCDSL5MRXQ44BWITRLP23BUUKH3OA4ITCLYAMNDDASH4BGONXKWY2NX5" };
/** A second contributor, connected to another X account. */
const OTHER = { pubkey: Keypair.random().publicKey() };
const POST = "1234567890";
const INPUT = { campaignSlug: "camp-1", workUrl: `https://x.com/deniz/status/${POST}` };
const FRIENDBOT = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const CREATOR = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
/** The X accounts the two wallets are connected to. */
const X_OWN = "111";
const X_OTHER = "222";

// The default post-author reader asks the composition root, which reads the
// environment: a valid one with no X credentials, so X is "not configured".
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  vi.stubEnv("TW_API_KEY", "k".repeat(16));
  // Throwaway seeds generated per run: the env schema needs three distinct valid ones.
  vi.stubEnv("PLATFORM_ADMIN_SECRET", Keypair.random().secret());
  vi.stubEnv("PLATFORM_OPS_SECRET", Keypair.random().secret());
  vi.stubEnv("DECISION_LEDGER_SECRET", Keypair.random().secret());
  vi.stubEnv("SESSION_SECRET", "s".repeat(43));
  for (const name of ["X_CLIENT_ID", "X_CLIENT_SECRET", "X_REDIRECT_URI", "X_BEARER_TOKEN"]) vi.stubEnv(name, "");
});

let conn: Db;
let close: () => Promise<void>;
/** X as the lookup sees it: `POST` exists and CONTRIBUTOR's account wrote it. */
let x: FakeX;

async function addCampaign(n: number): Promise<void> {
  await conn.insert(campaigns).values({
    id: `cmp_${n}`,
    slug: `camp-${n}`,
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    fundedAt: new Date(),
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  });
}

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  await addCampaign(1);
  await conn.insert(xAccounts).values([
    { pubkey: CONTRIBUTOR.pubkey, xUserId: X_OWN },
    { pubkey: OTHER.pubkey, xUserId: X_OTHER },
  ]);
  x = new FakeX();
  x.addPost(POST, X_OWN);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

const reader =
  (answer: boolean): TrustlineReader =>
  async () =>
    answer;

const fundedBy =
  (source: string | null): FundingSourceReader =>
  async () =>
    source;

/** The lookup every test uses unless it names another: the fake X of this test. */
const author: PostAuthorReader = (postId) => x.postAuthor(postId);

/** Everything written to stdout and stderr from here on. */
function captureLogs(): () => string {
  const lines: string[] = [];
  const keep = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(keep);
  vi.spyOn(process.stderr, "write").mockImplementation(keep);
  return () => lines.join("");
}

describe("createSubmission trustline gate", () => {
  it("refuses a wallet without a USDC trustline with CONFLICT and writes nothing", async () => {
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(false), fundedBy(FRIENDBOT), author)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "wallet needs a USDC trustline",
    });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("accepts a wallet that can receive USDC", async () => {
    const asked: string[] = [];
    const s = await createSubmission(
      INPUT,
      CONTRIBUTOR,
      conn,
      async (pk) => {
        asked.push(pk);
        return true;
      },
      fundedBy(FRIENDBOT),
      author,
    );
    expect(s.contributorPubkey).toBe(CONTRIBUTOR.pubkey);
    expect(asked).toEqual([CONTRIBUTOR.pubkey]);
  });

  it("fails closed when Horizon cannot be read", async () => {
    const down: TrustlineReader = async () => {
      throw new Error("Horizon answered 503");
    };
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, down, fundedBy(FRIENDBOT), author)).rejects.toMatchObject({ code: "LEDGER" });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("reports a duplicate before asking Horizon", async () => {
    await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), author);
    let asked = false;
    await expect(
      createSubmission(
        INPUT,
        CONTRIBUTOR,
        conn,
        async () => {
          asked = true;
          return true;
        },
        fundedBy(FRIENDBOT),
        author,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "you already submitted to this campaign" });
    expect(asked).toBe(false);
  });

  it("does not spend an X lookup on a wallet that could not be paid", async () => {
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(false), fundedBy(FRIENDBOT), author)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(x.lookedUp).toEqual([]);
  });
});

describe("createSubmission funding source", () => {
  it("stores the account that created the session wallet", async () => {
    const asked: string[] = [];
    const s = await createSubmission(
      INPUT,
      CONTRIBUTOR,
      conn,
      reader(true),
      async (pk) => {
        asked.push(pk);
        return CREATOR;
      },
      author,
    );
    expect(asked).toEqual([CONTRIBUTOR.pubkey]);
    expect(s.fundingSource).toBe(CREATOR);
    expect((await conn.select().from(submissions))[0]?.fundingSource).toBe(CREATOR);
  });

  it("stores a public source raw, so the exclusion list applies when the queue is read", async () => {
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), author);
    expect(s.fundingSource).toBe(FRIENDBOT);
  });

  it("accepts the submission with an unknown source when Horizon fails, and only logs a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const down: FundingSourceReader = async () => {
      throw new Error("Horizon answered 503");
    };
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), down, author);
    expect(s).toMatchObject({ status: "pending", fundingSource: null });
    expect(await conn.select().from(submissions)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("funding source lookup failed", { campaign: "camp-1", wallet: CONTRIBUTOR.pubkey, err: "Horizon answered 503" });
  });

  it("stores an unknown source when the account has no creation record", async () => {
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(null), author);
    expect(s).toMatchObject({ status: "pending", fundingSource: null });
  });

  it("does not look the source up for a submission the trustline gate refuses", async () => {
    let asked = false;
    await expect(
      createSubmission(
        INPUT,
        CONTRIBUTOR,
        conn,
        reader(false),
        async () => {
          asked = true;
          return CREATOR;
        },
        author,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(asked).toBe(false);
  });

  it("does not look the source up for a post the X gate refuses", async () => {
    let asked = false;
    await expect(
      createSubmission(
        INPUT,
        OTHER,
        conn,
        reader(true),
        async () => {
          asked = true;
          return CREATOR;
        },
        author,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(asked).toBe(false);
  });
});

describe("createSubmission during a close", () => {
  async function closeOp(status: EscrowOp["status"], ageMs = 0): Promise<void> {
    await conn.insert(escrowOps).values({
      id: "op_close",
      campaignId: "cmp_1",
      kind: "dispute",
      idempotencyKey: "dispute-close:cmp_1",
      payload: {},
      status,
      updatedAt: new Date(Date.now() - ageMs),
    });
  }

  it.each(["intent", "submitted", "confirmed"] as const)("refuses while the close dispute is %s and writes nothing", async (status) => {
    await closeOp(status);
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), author)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "campaign is closing",
    });
    expect(await conn.select().from(submissions)).toHaveLength(0);
    expect(x.lookedUp).toEqual([]);
  });

  it.each(["intent", "submitted"] as const)("accepts once a %s close is stale", async (status) => {
    await closeOp(status, STALE_SUBMITTED_MS + 1_000);
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), author)).resolves.toMatchObject({ status: "pending" });
  });

  it("accepts again after the close failed and the campaign is still open", async () => {
    await closeOp("failed");
    const s = await createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), author);
    expect(s.status).toBe("pending");
  });

  it("ignores in-flight ops of other kinds", async () => {
    await conn.insert(escrowOps).values({ id: "op_rel", campaignId: "cmp_1", kind: "release", idempotencyKey: "release:cmp_1:1", payload: {}, status: "submitted" });
    await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), author)).resolves.toMatchObject({ status: "pending" });
  });
});

describe("createSubmission X author gate", () => {
  const submit = (input: { campaignSlug: string; workUrl: string }, actor: { pubkey: string }, lookup: PostAuthorReader = author) =>
    createSubmission(input, actor, conn, reader(true), fundedBy(FRIENDBOT), lookup);

  it("own post: accepts a post written by the wallet's connected X account", async () => {
    const s = await submit(INPUT, CONTRIBUTOR);
    expect(s).toMatchObject({ status: "pending", contributorPubkey: CONTRIBUTOR.pubkey, postId: POST, workUrl: INPUT.workUrl });
    expect(await conn.select().from(submissions)).toHaveLength(1);
  });

  it("asks X about the numeric post ID alone, once, whatever the link carried", async () => {
    await submit({ ...INPUT, workUrl: `https://twitter.com/Deniz_K/status/${POST}/photo/1?s=20&t=abc#frag` }, CONTRIBUTOR);
    expect(x.lookedUp).toEqual([POST]);
  });

  it("keeps the handle the contributor typed in the stored link; the handle decides nothing", async () => {
    // The link names someone else's handle, the post's author is still the connected account.
    const s = await submit({ ...INPUT, workUrl: `https://x.com/not_my_handle/status/${POST}` }, CONTRIBUTOR);
    expect(s.workUrl).toBe(`https://x.com/not_my_handle/status/${POST}`);
    expect(s.postId).toBe(POST);
  });

  it("someone else's post: refuses a post another X account wrote and stores nothing", async () => {
    await expect(submit(INPUT, OTHER)).rejects.toMatchObject({ code: "FORBIDDEN", message: "this post was written by another X account" });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("is not fooled by the author's handle in the link of another account's post", async () => {
    x.addPost("777", X_OWN);
    await expect(submit({ ...INPUT, workUrl: "https://x.com/other_handle/status/777" }, OTHER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("no X account: refuses without asking X or Horizon, and stores nothing", async () => {
    const unbound = { pubkey: Keypair.random().publicKey() };
    let horizon = false;
    await expect(
      createSubmission(
        INPUT,
        unbound,
        conn,
        async () => {
          horizon = true;
          return true;
        },
        fundedBy(FRIENDBOT),
        author,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "connect your X account first" });
    expect(x.lookedUp).toEqual([]);
    expect(horizon).toBe(false);
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  it("reads the binding through the injected reader", async () => {
    const asked: string[] = [];
    const s = await createSubmission(INPUT, { pubkey: "G_UNBOUND" }, conn, reader(true), fundedBy(FRIENDBOT), author, async (pk) => {
      asked.push(pk);
      return { xUserId: X_OWN };
    });
    expect(asked).toEqual(["G_UNBOUND"]);
    expect(s.postId).toBe(POST);
  });

  it("post not found: refuses a post X says does not exist, was deleted or is not public", async () => {
    await expect(submit({ ...INPUT, workUrl: "https://x.com/deniz/status/404404" }, CONTRIBUTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "this post could not be found on X, it must be public",
    });
    expect(x.lookedUp).toEqual(["404404"]);
    expect(await conn.select().from(submissions)).toHaveLength(0);
  });

  describe("X cannot answer", () => {
    const BODY = "post text sentinel";

    it.each<[string, AppError, Record<string, unknown>]>([
      ["a timeout", new AppError("X", "x post request failed", { step: "post", reason: "unreachable" }), { step: "post", reason: "unreachable" }],
      [
        "429",
        new AppError("X", "x post request failed", { step: "post", reason: "status", status: 429, resetAt: 1791900000 }),
        { step: "post", reason: "status", status: 429, resetAt: 1791900000 },
      ],
      ["503", new AppError("X", "x post request failed", { step: "post", reason: "status", status: 503 }), { step: "post", reason: "status", status: 503 }],
      ["an unexpected body", new AppError("X", "x post request failed", { step: "post", reason: "body", status: 200 }), { step: "post", reason: "body", status: 200 }],
    ])("refuses with a retry message on %s, stores nothing and logs the step alone", async (_label, error, logged) => {
      const logs = captureLogs();
      await expect(
        submit(INPUT, CONTRIBUTOR, async () => {
          throw error;
        }),
      ).rejects.toMatchObject({ code: "X", message: "couldn't check the post with X, try again" });
      expect(await conn.select().from(submissions)).toHaveLength(0);

      const lines = logs().trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toEqual({ t: expect.any(String), level: "warn", msg: "post author lookup failed", campaign: "camp-1", wallet: CONTRIBUTOR.pubkey, ...logged });
    });

    it("gives the contributor the retry message and no detail of the failure", async () => {
      const error = await submit(INPUT, CONTRIBUTOR, async () => {
        throw new AppError("X", "x post request failed", { step: "post", reason: "status", status: 401 });
      }).then(
        () => null,
        (e: unknown) => e as AppError,
      );
      expect(error?.details).toBeUndefined();
      expect(error?.cause).toBeUndefined();
    });

    it("refuses when X is not configured: the default lookup fails, it does not pass", async () => {
      const logs = captureLogs();
      // No sixth argument: the reader the route uses, over an environment with no X credentials.
      await expect(createSubmission(INPUT, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT))).rejects.toMatchObject({
        code: "X",
        message: "couldn't check the post with X, try again",
      });
      expect(await conn.select().from(submissions)).toHaveLength(0);
      expect(JSON.parse(logs().trim())).toMatchObject({ msg: "post author lookup failed", step: "post", reason: "not_configured" });
    });

    it("refuses on a failure that is not the adapter's, and logs nothing that failure carries", async () => {
      const logs = captureLogs();
      await expect(
        submit(INPUT, CONTRIBUTOR, async () => {
          throw new Error(`boom ${BODY}`);
        }),
      ).rejects.toMatchObject({ code: "X", message: "couldn't check the post with X, try again" });
      expect(await conn.select().from(submissions)).toHaveLength(0);
      const text = logs();
      expect(text).toContain('"reason":"unexpected"');
      expect(text).not.toContain(BODY);
    });

    it("refuses when the lookup fails with another typed error, without logging its details", async () => {
      const logs = captureLogs();
      await expect(
        submit(INPUT, CONTRIBUTOR, async () => {
          throw new AppError("INTERNAL", "boom", { body: BODY });
        }),
      ).rejects.toMatchObject({ code: "X" });
      expect(logs()).not.toContain(BODY);
    });
  });

  describe("with the real adapter", () => {
    const APP_BEARER = "app.bearer.sentinel.1";
    const HANDLE = "handle_sentinel_1";
    const TEXT = "post text sentinel";
    const NAME = "Name Sentinel";
    const config = { clientId: "client-id-1", clientSecret: "client-pass-1", redirectUri: "https://proofwork.test/api/x/callback", bearerToken: APP_BEARER };

    /** The adapter over an X that answers every post lookup with `reply`; `seen` holds the URLs it was asked for. */
    function xAnswering(reply: FakeReply): { lookup: PostAuthorReader; seen: string[] } {
      const seen: string[] = [];
      const api = new XApi(
        config,
        fakeFetch((url) => {
          seen.push(url);
          return reply;
        }),
      );
      return { lookup: (postId) => api.postAuthor(postId), seen };
    }

    const postBy = (authorId: string): FakeReply => ({
      status: 200,
      body: { data: { id: POST, text: TEXT, author_id: authorId, username: HANDLE }, includes: { users: [{ id: authorId, name: NAME, username: HANDLE }] } },
    });

    it("accepts the own post and keeps nothing of X's reply: no text, handle, name or author ID in the row or the logs", async () => {
      // An account ID long enough that it cannot turn up by chance in a generated ID or a timestamp.
      const X_LONG = "7770001234567890";
      const wallet = { pubkey: Keypair.random().publicKey() };
      await conn.insert(xAccounts).values({ pubkey: wallet.pubkey, xUserId: X_LONG });
      const { lookup, seen } = xAnswering(postBy(X_LONG));
      const logs = captureLogs();
      const s = await submit(INPUT, wallet, lookup);

      // The fixed API host and the post ID; the submitted link itself is never fetched.
      expect(seen).toEqual([`https://api.x.com/2/tweets/${POST}?expansions=author_id`]);
      expect(logs()).toBe("");
      const stored = JSON.stringify([s, await conn.select().from(submissions)]);
      for (const leak of [TEXT, HANDLE, NAME, APP_BEARER, X_LONG]) expect(stored).not.toContain(leak);
    });

    it("refuses another account's post without logging or storing anything of the reply", async () => {
      const { lookup } = xAnswering(postBy("333"));
      const logs = captureLogs();
      await expect(submit(INPUT, CONTRIBUTOR, lookup)).rejects.toMatchObject({ code: "FORBIDDEN", message: "this post was written by another X account" });
      expect(logs()).toBe("");
      expect(await conn.select().from(submissions)).toHaveLength(0);
    });

    it("refuses a post X cannot find", async () => {
      const { lookup } = xAnswering({
        status: 200,
        body: { errors: [{ type: "https://api.x.com/2/problems/resource-not-found", detail: `Could not find tweet by ${HANDLE}` }] },
      });
      const logs = captureLogs();
      await expect(submit(INPUT, CONTRIBUTOR, lookup)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(logs()).toBe("");
      expect(await conn.select().from(submissions)).toHaveLength(0);
    });

    it.each<[string, FakeReply, Record<string, unknown>]>([
      ["answers 429", { status: 429, body: { detail: HANDLE }, headers: { "x-rate-limit-reset": "1791900000" } }, { reason: "status", status: 429, resetAt: 1791900000 }],
      ["answers 500 and echoes the post", { status: 500, body: { detail: `${TEXT} ${HANDLE}` } }, { reason: "status", status: 500 }],
      ["answers 401 and echoes the token", { status: 401, body: { detail: `bad ${APP_BEARER}` } }, { reason: "status", status: 401 }],
      ["answers a post with a handle but no author ID", { status: 200, body: { data: { id: POST, text: TEXT, username: HANDLE } } }, { reason: "body", status: 200 }],
      ["answers with a page", new Response(`<html>${TEXT}</html>`, { status: 200 }), { reason: "body", status: 200 }],
    ])("stores nothing and logs only the failed step when X %s", async (_label, reply, logged) => {
      const { lookup } = xAnswering(reply);
      const logs = captureLogs();
      await expect(submit(INPUT, CONTRIBUTOR, lookup)).rejects.toMatchObject({ code: "X", message: "couldn't check the post with X, try again" });
      expect(await conn.select().from(submissions)).toHaveLength(0);

      const text = logs();
      const lines = text.trim().split("\n");
      expect(lines).toHaveLength(1);
      // Time, level, message, campaign, wallet and the adapter's step, reason and status: nothing else rides along.
      expect(JSON.parse(lines[0] ?? "")).toEqual({
        t: expect.any(String),
        level: "warn",
        msg: "post author lookup failed",
        campaign: "camp-1",
        wallet: CONTRIBUTOR.pubkey,
        step: "post",
        ...logged,
      });
      for (const leak of [TEXT, HANDLE, NAME, APP_BEARER, config.clientSecret]) expect(text).not.toContain(leak);
    });
  });
});

describe("createSubmission one post, one submission", () => {
  const submit = (workUrl: string, actor: { pubkey: string }, campaign = 1) =>
    createSubmission({ campaignSlug: `camp-${campaign}`, workUrl }, actor, conn, reader(true), fundedBy(FRIENDBOT), author);

  beforeEach(() => {
    x.addPost("999", X_OWN);
  });

  it.each([
    ["another spelling of the handle", "https://x.com/ALICE_/status/999"],
    ["the twitter.com host and another handle", "https://twitter.com/bob/status/999"],
    ["a tracking tail", "https://x.com/alice/status/999?s=20"],
    ["the same link", "https://x.com/alice/status/999"],
  ])("same post, other handle: refuses %s as already submitted, without asking X", async (_label, again) => {
    await submit("https://x.com/alice/status/999", CONTRIBUTOR);
    expect(x.lookedUp).toEqual(["999"]);

    await expect(submit(again, OTHER)).rejects.toMatchObject({ code: "CONFLICT", message: "this post has already been submitted" });
    expect(x.lookedUp).toEqual(["999"]);
    expect(await conn.select().from(submissions)).toHaveLength(1);
  });

  it("holds across campaigns: a post submitted to one campaign is taken in every other", async () => {
    await addCampaign(2);
    await submit("https://x.com/alice/status/999", CONTRIBUTOR, 1);
    await expect(submit("https://x.com/Alice/status/999", CONTRIBUTOR, 2)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "this post has already been submitted",
    });
    expect(await conn.select().from(submissions)).toHaveLength(1);
  });

  it("a different post is not a duplicate", async () => {
    await addCampaign(2);
    await submit("https://x.com/alice/status/999", CONTRIBUTOR, 1);
    await expect(submit(`https://x.com/alice/status/${POST}`, CONTRIBUTOR, 2)).resolves.toMatchObject({ postId: POST });
  });

  it("counts an earlier row by its backfilled post ID, under any handle", async () => {
    await conn.insert(submissions).values({ id: "sub_m1", shortId: "m1aaaaaa", campaignId: "cmp_1", contributorPubkey: "G_M1", workUrl: "https://x.com/alice/status/999", postId: "999" });
    await expect(submit("https://twitter.com/ALICE_/status/999", CONTRIBUTOR)).rejects.toMatchObject({ code: "CONFLICT", message: "this post has already been submitted" });
    expect(x.lookedUp).toEqual([]);
  });

  it("counts an earlier row without a post ID by its link", async () => {
    await conn.insert(submissions).values({ id: "sub_m1", shortId: "m1aaaaaa", campaignId: "cmp_1", contributorPubkey: "G_M1", workUrl: "https://x.com/alice/status/999" });
    await expect(submit("https://twitter.com/alice/status/999", CONTRIBUTOR)).rejects.toMatchObject({ code: "CONFLICT", message: "this post has already been submitted" });
    expect(x.lookedUp).toEqual([]);
  });

  it("counts earlier rows without a post ID under another handle: the ID that ends their link is the post", async () => {
    // What the backfill leaves when two rows share a post, and what the previous release stores before it is replaced.
    await conn.insert(submissions).values([
      { id: "sub_m1", shortId: "m1aaaaaa", campaignId: "cmp_1", contributorPubkey: "G_M1", workUrl: "https://x.com/alice/status/999" },
      { id: "sub_m2", shortId: "m1bbbbbb", campaignId: "cmp_1", contributorPubkey: "G_M2", workUrl: "https://x.com/ALICE_/status/999" },
    ]);
    for (const again of ["https://x.com/Alice/status/999", "https://twitter.com/bob/status/999?s=20"]) {
      await expect(submit(again, CONTRIBUTOR)).rejects.toMatchObject({ code: "CONFLICT", message: "this post has already been submitted" });
    }
    expect(x.lookedUp).toEqual([]);
    expect(await conn.select().from(submissions)).toHaveLength(2);
  });

  it("does not take a longer ID that ends in the same digits for the same post", async () => {
    await conn.insert(submissions).values({ id: "sub_m1", shortId: "m1aaaaaa", campaignId: "cmp_1", contributorPubkey: "G_M1", workUrl: "https://x.com/alice/status/1999" });
    await expect(submit("https://x.com/alice/status/999", CONTRIBUTOR)).resolves.toMatchObject({ postId: "999" });
  });

  /** A lookup that answers `authorId`, but only once `n` callers of `meet` are waiting: both requests have then passed every check and their inserts race. */
  function meeting(n: number): (authorId: string) => PostAuthorReader {
    let waiting = 0;
    let open: () => void = () => undefined;
    const all = new Promise<void>((resolve) => {
      open = resolve;
    });
    return (authorId) => async () => {
      if (++waiting === n) open();
      await all;
      return { found: true, authorId };
    };
  }

  it("concurrent duplicate: two wallets submitting one post at once leave one row, the other is told it is taken", async () => {
    // Each lookup names the asking wallet's own account, so only the database can refuse the second row.
    const lookup = meeting(2);
    const results = await Promise.allSettled([
      createSubmission({ campaignSlug: "camp-1", workUrl: "https://x.com/alice/status/999" }, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), lookup(X_OWN)),
      createSubmission({ campaignSlug: "camp-1", workUrl: "https://twitter.com/ALICE_/status/999" }, OTHER, conn, reader(true), fundedBy(FRIENDBOT), lookup(X_OTHER)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(refused?.reason).toMatchObject({ code: "CONFLICT", message: "this post has already been submitted" });
    const rows = await conn.select().from(submissions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.postId).toBe("999");
  });

  it("concurrent double submit: one wallet sending two posts at once keeps one, the other is told it already submitted", async () => {
    const lookup = meeting(2);
    const results = await Promise.allSettled([
      createSubmission({ campaignSlug: "camp-1", workUrl: "https://x.com/alice/status/999" }, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), lookup(X_OWN)),
      createSubmission({ campaignSlug: "camp-1", workUrl: `https://x.com/alice/status/${POST}` }, CONTRIBUTOR, conn, reader(true), fundedBy(FRIENDBOT), lookup(X_OWN)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(refused?.reason).toMatchObject({ code: "CONFLICT", message: "you already submitted to this campaign" });
    expect(await conn.select().from(submissions)).toHaveLength(1);
  });

  it("the database refuses a second row for one post ID on its own", async () => {
    const row = (n: number, handle: string) => ({ id: `sub_${n}`, shortId: `short_${n}`, campaignId: "cmp_1", contributorPubkey: `G_C${n}`, workUrl: `https://x.com/${handle}/status/999`, postId: "999" });
    await conn.insert(submissions).values(row(1, "alice"));
    await expect(conn.insert(submissions).values(row(2, "ALICE_"))).rejects.toThrow();
    expect(await conn.select().from(submissions)).toHaveLength(1);
  });
});
