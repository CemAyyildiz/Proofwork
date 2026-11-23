import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { jsonRoute } from "@/lib/http";

const post = (body: string) => new Request("https://proofwork.test/api/x", { method: "POST", headers: { "content-type": "application/json" }, body });

describe("jsonRoute", () => {
  it("answers 400 for a body that is not JSON", async () => {
    const route = jsonRoute(z.object({}), async () => ({ ok: true }));
    const res = await route(post("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION", message: "malformed JSON" });
  });

  it("answers 500, not 400, when the handler itself throws a SyntaxError", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const route = jsonRoute(z.object({}), async () => {
      JSON.parse("{broken");
      return { ok: true };
    });
    const res = await route(post("{}"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "INTERNAL" });
    vi.restoreAllMocks();
  });
});
