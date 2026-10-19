import { describe, expect, it, vi } from "vitest";
import { describeRelease, releaseSelected, type PreparedRelease, type ReleaseDeps, type ReleaseOutcome } from "@/components/release-flow";

const HASH = (n: number) => String(n).repeat(64).slice(0, 64);

/**
 * A server holding `releasable` selected payouts (milestones 1..n) and a
 * wallet that signs. Each step can be overridden to fail at the n-th call.
 */
function world(releasable: number, over: Partial<Pick<ReleaseDeps, "prepare" | "sign" | "submit">> = {}) {
  let next = 1;
  const prepare = vi.fn(async (): Promise<PreparedRelease | null> => (next <= releasable ? { opId: `op_${next}`, unsignedXdr: `xdr_${next}` } : null));
  const sign = vi.fn(async (xdr: string) => `signed_${xdr}`);
  const submit = vi.fn(async ({ opId }: { opId: string; signedXdr: string }) => {
    const idx = Number(opId.slice(3));
    next = idx + 1;
    return { milestoneIndex: idx, txHash: HASH(idx) };
  });
  return { prepare: over.prepare ?? prepare, sign: over.sign ?? sign, submit: over.submit ?? submit, defaults: { prepare, sign, submit } };
}

/** Fails the n-th call (1-based) with `error`, otherwise behaves as `inner`. */
function failOn<A extends unknown[], R>(n: number, error: unknown, inner: (...a: A) => Promise<R>) {
  let calls = 0;
  return vi.fn(async (...a: A): Promise<R> => {
    calls += 1;
    if (calls === n) throw error;
    return inner(...a);
  });
}

/** The outcome as the page lays it out, with each released tx shown as "tx". */
function text(o: ReleaseOutcome, released: number): string {
  const links = Array.from({ length: released }, () => "tx").join(", ");
  return o.headline ? `${o.headline} (${links}).${o.detail ? ` ${o.detail}` : ""}` : o.detail;
}

const IDS = ["sub_1", "sub_2", "sub_3"];

describe("releaseSelected", () => {
  it("releases every selected payout, one prepare → sign → submit at a time, with progress", async () => {
    const w = world(2);
    const progress: string[] = [];
    const res = await releaseSelected({ submissionIds: ["sub_1", "sub_3"], ...w, onProgress: (n, t) => progress.push(`Signing ${n} of ${t}…`) });
    expect(res).toEqual({ released: [{ milestoneIndex: 1, txHash: HASH(1) }, { milestoneIndex: 2, txHash: HASH(2) }], unsent: 0, stop: null });
    expect(progress).toEqual(["Signing 1 of 2…", "Signing 2 of 2…"]);
    // Every prepare names the selection, never the whole campaign.
    for (const call of w.defaults.prepare.mock.calls as unknown[][]) expect(call[0]).toEqual(["sub_1", "sub_3"]);
    expect(w.defaults.sign.mock.calls.map((c) => c[0])).toEqual(["xdr_1", "xdr_2"]);
    expect(text(describeRelease(res, 2), 2)).toBe("2 of 2 released (tx, tx).");
    expect(describeRelease(res, 2).tone).toBe("ok");
  });

  it("does not ask the server more than once per selected payout", async () => {
    const prepare = vi.fn(async () => ({ opId: "op_1", unsignedXdr: "xdr_1" }));
    const w = world(0, { prepare });
    const res = await releaseSelected({ submissionIds: ["sub_1", "sub_1", "sub_2"], ...w });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(res.released).toHaveLength(2);
  });

  it("a selection the server will not release: nothing built, listed as not releasable", async () => {
    const w = world(0);
    const none = await releaseSelected({ submissionIds: ["sub_1", "sub_2"], ...w });
    expect(none).toEqual({ released: [], unsent: 0, stop: null });
    expect(w.defaults.sign).not.toHaveBeenCalled();
    expect(describeRelease(none, 2)).toEqual({
      tone: "muted",
      headline: null,
      detail: "None of the 2 selected payouts can be released (not approved, already paid or not in this campaign). Nothing was sent.",
    });

    const some = await releaseSelected({ submissionIds: IDS, ...world(2) });
    expect(text(describeRelease(some, 3), 2)).toBe("2 of 3 released (tx, tx). 1 not releasable (not approved, already paid or not in this campaign).");
  });

  it("cancel midway: lists what was released and what was not sent", async () => {
    const base = world(3);
    const sign = failOn(2, { code: -4, message: "User declined access" }, base.defaults.sign);
    const res = await releaseSelected({ submissionIds: IDS, prepare: base.prepare, sign, submit: base.submit });
    expect(res).toEqual({ released: [{ milestoneIndex: 1, txHash: HASH(1) }], unsent: 2, stop: { kind: "cancelled", message: "Signature cancelled in your wallet" } });
    expect(text(describeRelease(res, 3), 1)).toBe("1 of 3 released (tx). Signature cancelled in your wallet; 2 not sent.");
  });

  it("cancel first: nothing was sent", async () => {
    const sign = failOn(1, { code: -4, message: "rejected" }, async (x: string) => x);
    const w = world(3, { sign });
    const res = await releaseSelected({ submissionIds: IDS, ...w });
    expect(res).toMatchObject({ released: [], unsent: 3, stop: { kind: "cancelled" } });
    expect(w.defaults.submit).not.toHaveBeenCalled();
    expect(describeRelease(res, 3)).toEqual({ tone: "muted", headline: null, detail: "Signature cancelled in your wallet. Nothing was sent." });
  });

  it("a server error after a release is an error with the server's text, never a cancel", async () => {
    const base = world(3);
    const prepare = failOn(2, new Error("release already rejected by the escrow (409)"), base.defaults.prepare);
    const res = await releaseSelected({ submissionIds: IDS, prepare, sign: base.sign, submit: base.submit });
    expect(res).toEqual({
      released: [{ milestoneIndex: 1, txHash: HASH(1) }],
      unsent: 2,
      stop: { kind: "failed", message: "release already rejected by the escrow (409)" },
    });
    const out = describeRelease(res, 3);
    expect(out.tone).toBe("fail");
    expect(text(out, 1)).toBe("1 of 3 released (tx). Release stopped: release already rejected by the escrow (409); 2 not sent.");
    expect(out.detail).not.toMatch(/cancel/i);
  });

  it("a wallet failure that is not a decline is an error, not a cancel", async () => {
    const sign = failOn(1, new Error("Freighter is locked"), async (x: string) => x);
    const res = await releaseSelected({ submissionIds: ["sub_1"], ...world(1, { sign }) });
    expect(res.stop).toEqual({ kind: "failed", message: "Freighter is locked" });
    expect(describeRelease(res, 1)).toEqual({ tone: "fail", headline: null, detail: "Release stopped: Freighter is locked. Nothing was sent." });
  });

  it("submit fails after signing: that payout may have reached the chain, it is never counted as not sent", async () => {
    const base = world(3);
    const submit = failOn(2, new Error("send-transaction timed out"), base.defaults.submit);
    const res = await releaseSelected({ submissionIds: IDS, prepare: base.prepare, sign: base.sign, submit });
    expect(res).toEqual({ released: [{ milestoneIndex: 1, txHash: HASH(1) }], unsent: 1, stop: { kind: "unknown", message: "send-transaction timed out" } });
    expect(text(describeRelease(res, 3), 1)).toBe(
      "1 of 3 released (tx). Payout 2 of 3 may have reached the chain; refresh to see (send-transaction timed out). 1 not sent.",
    );

    const only = await releaseSelected({
      submissionIds: ["sub_1"],
      ...world(1, { submit: failOn(1, new Error("Stellar rejected the transaction"), async () => ({ milestoneIndex: 1, txHash: HASH(1) })) }),
    });
    expect(only).toMatchObject({ released: [], unsent: 0, stop: { kind: "unknown" } });
    const out = describeRelease(only, 1);
    expect(out.detail).toBe("Payout 1 of 1 may have reached the chain; refresh to see (Stellar rejected the transaction).");
    expect(out.detail).not.toMatch(/not sent|Nothing was sent|cancel/);
  });
});
