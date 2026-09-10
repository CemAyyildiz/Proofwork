import { notFound } from "next/navigation";
import { HashCheck } from "@/components/hash-check";
import { publicEnv } from "@/config/public-env";
import { SIGNALS } from "@/domain/rubric";
import { getDecision } from "@/services/review";

export const dynamic = "force-dynamic";

/**
 * Public verification page. Everything needed to check the decision without
 * trusting this server: the canonical JSON, its hash, the transaction that
 * carries that hash as memo, and a browser-side recomputation.
 */
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getDecision(id);
  if (!row) notFound();
  const { d, s, c } = row;
  const signals = d.signals as Record<string, boolean>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Decision {s.shortId}{d.appealOf ? " · re-review" : ""}</h1>
        <p className="text-sm text-neutral-500">
          Campaign {c.title} · <a className="underline" href={s.workUrl} target="_blank" rel="noreferrer">submission</a>
        </p>
      </div>

      <section className="rounded border border-neutral-200 p-4 text-sm">
        <p className="text-lg">
          <strong>{d.outcome}</strong> · {d.reasonCode}
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
          {SIGNALS.map((sg) => (
            <li key={sg.id} className={signals[sg.id] ? "text-green-700" : "text-red-700"}>
              {signals[sg.id] ? "✓" : "✗"} {sg.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-neutral-700">{d.note}</p>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="font-medium">On-chain record</h2>
        {d.txHash ? (
          <p>
            Transaction{" "}
            <a className="underline" href={publicEnv.explorerTxUrl(d.txHash)} target="_blank" rel="noreferrer">
              {d.txHash.slice(0, 16)}…
            </a>{" "}
            from the decision ledger account carries a <code>manage_data</code> entry <code>{d.ledgerKey}</code> and a{" "}
            <code>memo_hash</code> equal to the SHA-256 below.
          </p>
        ) : (
          <p className="text-red-700">Not committed on-chain yet.</p>
        )}
        <p>
          Recorded hash: <code className="break-all text-xs">{d.decisionHash}</code>
        </p>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="font-medium">Verify it yourself</h2>
        <p className="text-neutral-600">
          The canonical record below is what was hashed. Your browser recomputes SHA-256 of exactly these bytes and
          compares it with the recorded hash; compare that with the transaction memo in the explorer.
        </p>
        <HashCheck canonicalJson={d.canonicalJson} expectedHash={d.decisionHash} />
      </section>
    </div>
  );
}
