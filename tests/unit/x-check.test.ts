import { describe, expect, it } from "vitest";
import { XApi } from "@/x/api";
import { X_CHECK_USAGE, xCheck } from "@/x/check";
import { FakeX } from "@/x/fake";
import type { XPort } from "@/x/port";
import { fakeFetch } from "./fake-fetch";

const POST = "1841200000000000999";
const AUTHOR = "4242424242";
const OTHER = "777000777";

function xWith(posts: Record<string, string> = { [POST]: AUTHOR }): FakeX {
  const x = new FakeX();
  for (const [post, author] of Object.entries(posts)) x.addPost(post, author);
  return x;
}

const check = (argv: string[], x: XPort | null = xWith()) => xCheck(argv, () => x);

describe("xCheck", () => {
  it("a post written by the expected account: exit 0", async () => {
    await expect(check([POST, AUTHOR])).resolves.toEqual({ exitCode: 0, lines: ["post found", "author matches the expected account"] });
  });

  it("a post written by another account: exit 1", async () => {
    await expect(check([POST, OTHER])).resolves.toEqual({ exitCode: 1, lines: ["post found", "author does not match the expected account"] });
  });

  it("a post X cannot find: exit 1", async () => {
    await expect(check(["555", AUTHOR])).resolves.toEqual({ exitCode: 1, lines: ["post not found: X reports it as missing, deleted or not public"] });
  });

  it("X failing: exit 3 with the adapter's step, reason and status", async () => {
    const x = xWith();
    x.failPosts();
    await expect(check([POST, AUTHOR], x)).resolves.toEqual({ exitCode: 3, lines: ["X gave no usable answer (step post, reason status, status 503)"] });
  });

  it("X not configured: exit 3 and says so; a refused environment: exit 3 with its message", async () => {
    const off = await check([POST, AUTHOR], null);
    expect(off.exitCode).toBe(3);
    expect(off.lines[0]).toMatch(/^X is not configured: /);
    const refused = await xCheck([POST, AUTHOR], () => {
      throw new Error("Invalid environment: set the four X values together, or none of them");
    });
    expect(refused).toEqual({ exitCode: 3, lines: ["Invalid environment: set the four X values together, or none of them"] });
  });

  it.each([[[]], [[POST]], [[POST, AUTHOR, "3"]], [["0123", AUTHOR]], [[POST, "abc"]], [[POST, "@handle"]], [["https://x.com/a/status/1", AUTHOR]]])(
    "bad arguments %j: exit 2 with the usage line, and X is not asked",
    async (argv) => {
      const x = xWith();
      const result = await check(argv, x);
      expect(result.exitCode).toBe(2);
      expect(result.lines.at(-1)).toBe(X_CHECK_USAGE);
      expect(x.lookedUp).toEqual([]);
    },
  );

  it("a leading -- from pnpm is ignored", async () => {
    await expect(check(["--", POST, AUTHOR])).resolves.toMatchObject({ exitCode: 0 });
  });

  it("asks X about the post once", async () => {
    const x = xWith();
    await check([POST, AUTHOR], x);
    expect(x.lookedUp).toEqual([POST]);
  });

  it("no line carries an account ID, whatever the outcome", async () => {
    const down = xWith();
    down.failPosts();
    const outcomes = [await check([POST, AUTHOR]), await check([POST, OTHER]), await check(["555", AUTHOR]), await check([POST, AUTHOR], down)];
    for (const { lines } of outcomes) {
      const printed = lines.join("\n");
      expect(printed).not.toContain(AUTHOR);
      expect(printed).not.toContain(OTHER);
      expect(printed).not.toContain(POST);
    }
  });

  it("through the real adapter, nothing from X's reply is printed: no handle, name, text or token", async () => {
    const reply = {
      data: { id: POST, text: "post text sentinel", author_id: AUTHOR, edit_history_tweet_ids: [POST] },
      includes: { users: [{ id: AUTHOR, name: "Name Sentinel", username: "handle_sentinel_1" }] },
    };
    const api = new XApi(
      { clientId: "c", clientSecret: "s", redirectUri: "https://proofwork.test/api/x/callback", bearerToken: "app.bearer.sentinel.1" },
      fakeFetch(() => ({ status: 200, body: reply })),
    );
    for (const expected of [AUTHOR, OTHER]) {
      const { lines } = await check([POST, expected], api);
      const printed = lines.join("\n");
      for (const secret of ["handle_sentinel_1", "Name Sentinel", "post text sentinel", "app.bearer.sentinel.1", AUTHOR, OTHER]) expect(printed).not.toContain(secret);
    }
    await expect(check([POST, AUTHOR], api)).resolves.toMatchObject({ exitCode: 0 });
    await expect(check([POST, OTHER], api)).resolves.toMatchObject({ exitCode: 1 });
  });
});
