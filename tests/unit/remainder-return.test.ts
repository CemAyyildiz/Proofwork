import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/wallet/kit", () => ({ signTransaction: async () => "" }));

const { describeOutcome, RemainderRequestError, RemainderReturn, signAndSubmit } = await import("@/components/workspace/remainder-return");

const HASH = "f".repeat(64);
const OP = { opId: "op_1", unsignedXdr: "xdr_1" };

function deps(over: { sign?: () => Promise<string>; submit?: () => Promise<{ txHash: string }> } = {}) {
  const sign = vi.fn(over.sign ?? (async () => "signed_xdr_1"));
  const submit = vi.fn(over.submit ?? (async () => ({ txHash: HASH })));
  return { sign, submit };
}

describe("signAndSubmit", () => {
  it("signs the prepared XDR and hands the signed one to the server", async () => {
    const d = deps();
    expect(await signAndSubmit(OP, d)).toEqual({ kind: "returned", txHash: HASH });
    expect(d.sign).toHaveBeenCalledWith("xdr_1");
    expect(d.submit).toHaveBeenCalledWith({ opId: "op_1", signedXdr: "signed_xdr_1" });
  });

  it("a declined signature sends nothing and says so", async () => {
    const d = deps({ sign: () => Promise.reject({ code: -4, message: "User declined access" }) });
    const outcome = await signAndSubmit(OP, d);
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(d.submit).not.toHaveBeenCalled();
    if (outcome.kind === "returned") throw new Error("unreachable");
    expect(describeOutcome(outcome)).toEqual({ tone: "muted", text: "Signature cancelled in your wallet. Nothing was sent." });
  });

  it("a wallet failure that is not a cancel sends nothing and is not called a cancel", async () => {
    const d = deps({ sign: () => Promise.reject(new Error("wallet locked")) });
    const outcome = await signAndSubmit(OP, d);
    expect(outcome).toEqual({ kind: "not_sent", message: "wallet locked" });
    expect(d.submit).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 429])("a %i from the server is a refusal before anything was sent", async (status) => {
    const d = deps({ submit: () => Promise.reject(new RemainderRequestError("signed transaction does not match the prepared operation", status)) });
    const outcome = await signAndSubmit(OP, d);
    expect(outcome).toEqual({ kind: "not_sent", message: "signed transaction does not match the prepared operation" });
    if (outcome.kind === "returned") throw new Error("unreachable");
    expect(describeOutcome(outcome).text).toBe("signed transaction does not match the prepared operation. Nothing was sent.");
  });

  it.each([
    ["a 502", new RemainderRequestError("effect not visible on chain", 502)],
    ["a 500", new RemainderRequestError("internal error", 500)],
    ["a 409 after sending", new RemainderRequestError("withdraw_remaining changed concurrently; retry", 409)],
    ["a network error", new TypeError("fetch failed")],
  ])("%s after the signed transaction was handed over may have reached the chain", async (_name, error) => {
    const outcome = await signAndSubmit(OP, deps({ submit: () => Promise.reject(error) }));
    expect(outcome.kind).toBe("unknown");
    if (outcome.kind === "returned") throw new Error("unreachable");
    expect(describeOutcome(outcome)).toEqual({ tone: "fail", text: `The return may have reached the chain; refresh to see (${error.message}).` });
  });

  it("a server message that reads like a cancel is not taken for one", async () => {
    const outcome = await signAndSubmit(OP, deps({ submit: () => Promise.reject(new RemainderRequestError("request rejected", 502)) }));
    expect(outcome.kind).toBe("unknown");
  });
});

describe("RemainderReturn", () => {
  it("starts as one Return remainder button; nothing is shown as returned before the server says so", () => {
    const html = renderToStaticMarkup(createElement(RemainderReturn, { campaignId: "cmp_1", resolver: "G_RESOLVER" }));
    expect(html).toMatch(/<button[^>]*>.*?Return remainder.*?<\/button>/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("Settled");
    expect(html).not.toContain("Nothing was sent");
  });
});
