import { describe, expect, it } from "vitest";
import { withKvAliases } from "@/config/env";

describe("withKvAliases", () => {
  it("uses the Vercel KV REST pair when the Upstash pair is unset", () => {
    const out = withKvAliases({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" });
    expect(out.UPSTASH_REDIS_REST_URL).toBe("https://kv.example");
    expect(out.UPSTASH_REDIS_REST_TOKEN).toBe("t");
  });

  it("treats empty Upstash values as unset", () => {
    const out = withKvAliases({ UPSTASH_REDIS_REST_URL: " ", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" });
    expect(out.UPSTASH_REDIS_REST_URL).toBe("https://kv.example");
  });

  it("never mixes the two pairs once either Upstash value is set", () => {
    const src = { UPSTASH_REDIS_REST_URL: "https://up.example", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" };
    expect(withKvAliases(src)).toBe(src);
  });
});
