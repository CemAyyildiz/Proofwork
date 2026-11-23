import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/logger";

/** What the logger wrote, from both streams. */
function capture(): () => string {
  const out: string[] = [];
  const grab = (chunk: string | Uint8Array) => {
    out.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(grab);
  vi.spyOn(process.stderr, "write").mockImplementation(grab);
  return () => out.join("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger redaction", () => {
  it("never writes a Stellar secret seed or an api_key value, at any level or depth", () => {
    const seed = Keypair.random().secret();
    const written = capture();
    log.info("escrow call", { detail: `signed with ${seed}`, nested: { query: "https://tw.example/x?api_key=abc" } });
    log.error("escrow failed", { err: `bad key ${seed}`, list: ["api_key=abc"] });
    const text = written();
    expect(text).not.toContain(seed);
    expect(text).not.toContain("api_key=abc");
    expect(text).not.toMatch(/=abc\b/);
    expect(text.match(/\[redacted\]/g)).toHaveLength(4);
  });

  it("leaves a public key and ordinary fields as they are", () => {
    const pubkey = Keypair.random().publicKey();
    const written = capture();
    log.info("login", { pubkey, count: 3 });
    const line = JSON.parse(written()) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "info", msg: "login", pubkey, count: 3 });
  });
});
