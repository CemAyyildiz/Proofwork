import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/wallet/kit", () => ({ signTransaction: async () => "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { alreadyReturned, describeOutcome, describePrepareFailure, RemainderRequestError, RemainderReturn, signAndSubmit } = await import(
  "@/components/workspace/remainder-return"
);

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

describe("messages", () => {
  it("drops one trailing period before going on, so no line reads '..'", async () => {
    const outcome = await signAndSubmit(OP, deps({ submit: () => Promise.reject(new RemainderRequestError("signed transaction does not match.", 400)) }));
    if (outcome.kind === "returned") throw new Error("unreachable");
    expect(describeOutcome(outcome).text).toBe("signed transaction does not match. Nothing was sent.");
    expect(describePrepareFailure("campaign is not closed.")).toBe("Return not prepared: campaign is not closed.");
  });

  it("a refused prepare never claims nothing was sent", () => {
    const text = describePrepareFailure("withdraw_remaining is being submitted; wait for confirmation");
    expect(text).toBe("Return not prepared: withdraw_remaining is being submitted; wait for confirmation.");
    expect(text).not.toContain("Nothing was sent");
  });

  it.each([
    ["withdraw_remaining already confirmed (tx abc)", true],
    ["the remainder was already returned (tx abc)", true],
    ["withdraw_remaining is being submitted; wait for confirmation", false],
    ["campaign x is not closed in the app", false],
  ])("'%s' means the return already went out: %s", (text, expected) => {
    expect(alreadyReturned(text)).toBe(expected);
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
