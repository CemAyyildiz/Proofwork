import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { challengeMessage, verifySignedMessage } from "@/domain/wallet-auth";

describe("wallet challenge verification", () => {
  const kp = Keypair.random();
  const msg = challengeMessage("nonce123");

  it("accepts a SEP-53 signature", () => {
    const digest = createHash("sha256").update("Stellar Signed Message:\n" + msg).digest();
    const sig = kp.sign(digest).toString("base64");
    expect(verifySignedMessage(kp.publicKey(), msg, sig)).toBe(true);
  });

  it("accepts a raw-bytes signature", () => {
    const sig = kp.sign(Buffer.from(msg)).toString("base64");
    expect(verifySignedMessage(kp.publicKey(), msg, sig)).toBe(true);
  });

  it("rejects a signature from another key or over another message", () => {
    const other = Keypair.random();
    const sig = other.sign(Buffer.from(msg)).toString("base64");
    expect(verifySignedMessage(kp.publicKey(), msg, sig)).toBe(false);
    const sig2 = kp.sign(Buffer.from("different")).toString("base64");
    expect(verifySignedMessage(kp.publicKey(), msg, sig2)).toBe(false);
    expect(verifySignedMessage(kp.publicKey(), msg, "AAAA")).toBe(false);
  });
});
