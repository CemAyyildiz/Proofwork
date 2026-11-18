"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { publicEnv } from "@/config/public-env";
import { Button } from "@/components/ui/button";
import { HashChip } from "@/components/ui/hash-chip";
import { Pill } from "@/components/ui/pill";

export interface PendingRequestRow {
  id: string;
  pubkey: string;
  team: string;
  note: string;
  requestedAt: string;
}

export interface FunderAccessRow {
  pubkey: string;
  team: string | null;
  grantedAt: string;
}

export interface AccessLogRow {
  id: string;
  pubkey: string;
  role: string;
  /** Campaign the changed grant was scoped to; null for a global grant. */
  campaignId: string | null;
  action: "grant" | "revoke";
  /** The ops wallet that acted; null when the change came from the script. */
  actor: string | null;
  via: "admin" | "script";
  at: string;
}

type Mutation = { action: "approve" | "reject"; requestId: string } | { action: "revoke"; pubkey: string };

const th = "whitespace-nowrap px-4 py-3 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-white/60 first:pl-6";
const tdWrap = "px-4 py-4 align-top first:pl-6";
// `relative` keeps absolutely placed children (the sr-only Revoke header) inside the scroller, so a phone does not scroll the page sideways.
const table = "relative overflow-x-auto rounded-[24px] border border-white/[0.07] bg-[#0d0d0d] [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-white/[0.02]";
const h3 = "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/55";
const empty = "rounded-[22px] border border-dashed border-white/12 px-5 py-7 text-sm text-white/60";
/** Wallets, times and one-word values stay on one line; a narrow screen scrolls the table sideways instead. */
const td = `${tdWrap} whitespace-nowrap`;

function Wallet({ pubkey }: { pubkey: string }) {
  return <HashChip value={pubkey} head={4} tail={4} href={publicEnv.explorerAccountUrl(pubkey)} />;
}

/**
 * The operator's controls. Each button is one request to the admin route,
 * which checks the `ops` role again; the page reloads its data afterwards.
 * Nothing here decides on its own: every change is a click.
 */
export function AdminAccess({
  pending,
  funders,
  log,
  pendingCut,
  logCut,
}: {
  pending: PendingRequestRow[];
  funders: FunderAccessRow[];
  log: AccessLogRow[];
  /** The number of requests shown when more are waiting than the page read; null when all are shown. */
  pendingCut: number | null;
  /** The number of entries shown when older ones exist than the page read; null when all are shown. */
  logCut: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, body: Mutation) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message ?? `request failed (${res.status})`);
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
      // Also after a refusal: it usually means the list on screen is out of date.
      router.refresh();
    }
  }

  return (
    <div className="space-y-12">
      {error ? (
        <p role="alert" className="rounded-2xl border border-fail-line bg-fail-soft px-4 py-3 text-sm text-fail">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h3 className={h3}>Pending requests</h3>
        {pending.length === 0 ? (
          <p className={empty}>No pending requests.</p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {pending.map((r) => (
              <li key={r.id} data-surface="paper" className="flex flex-col rounded-[28px] bg-paper p-6 text-paper-ink">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="font-display text-[26px] leading-[0.95] [overflow-wrap:anywhere]" style={{ fontVariationSettings: `"wdth" 88, "wght" 820` }}>
                    {r.team}
                  </p>
                  <span className="rounded-full bg-[#000] [&>span]:border-0 [&>span]:bg-transparent [&>span]:text-white">
                    <Wallet pubkey={r.pubkey} />
                  </span>
                </div>
                <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{r.note}</p>
                <p className="mt-3 font-mono text-[11.5px] text-black/65">Requested {r.requestedAt}</p>
                <div className="mt-auto flex flex-wrap gap-2.5 pt-5 [&>button:last-child]:border-black/25 [&>button:last-child]:bg-transparent [&>button:last-child]:text-paper-ink [&>button:last-child:hover]:bg-black/5">
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    busy={busy === `approve:${r.id}`}
                    busyLabel="Approving…"
                    onClick={() => run(`approve:${r.id}`, { action: "approve", requestId: r.id })}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    busy={busy === `reject:${r.id}`}
                    busyLabel="Rejecting…"
                    onClick={() => run(`reject:${r.id}`, { action: "reject", requestId: r.id })}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pendingCut !== null ? (
          <p className="text-[12.5px] text-white/60">Showing the {pendingCut} oldest pending requests. More are waiting and appear as these are decided.</p>
        ) : null}
      </section>

      <section className="space-y-4">
        <h3 className={h3}>Funders</h3>
        {funders.length === 0 ? (
          <p className={empty}>No wallet has funder access.</p>
        ) : (
          <div className={table}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Wallet</th>
                  <th className={th}>Team</th>
                  <th className={th}>Granted</th>
                  <th className={th}>
                    <span className="sr-only">Revoke</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {funders.map((f) => (
                  <tr key={f.pubkey} className="border-t border-line">
                    <td className={td}>
                      <Wallet pubkey={f.pubkey} />
                    </td>
                    <td className={`${tdWrap} min-w-[10rem] font-semibold`}>{f.team ?? <span className="font-normal text-white/60">granted with the script</span>}</td>
                    <td className={td}>{f.grantedAt}</td>
                    <td className="px-4 py-4 pr-6 text-right align-top">
                      {confirming === f.pubkey ? (
                        <div className="flex flex-wrap justify-end gap-2.5">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy !== null}
                            busy={busy === `revoke:${f.pubkey}`}
                            busyLabel="Revoking…"
                            onClick={() => run(`revoke:${f.pubkey}`, { action: "revoke", pubkey: f.pubkey })}
                          >
                            Confirm revoke
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setConfirming(f.pubkey)}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12.5px] leading-relaxed text-white/60">
          A revoked wallet can no longer create, deploy or fund a campaign. It keeps final approval, release and close on
          campaigns it already funded.
        </p>
      </section>

      <section className="space-y-4">
        <h3 className={h3}>Access log</h3>
        {log.length === 0 ? (
          <p className={empty}>No role has been granted or revoked yet.</p>
        ) : (
          <div className={table}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Wallet</th>
                  <th className={th}>Role</th>
                  <th className={th}>Action</th>
                  <th className={th}>By</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className={td}>{e.at}</td>
                    <td className={td}>
                      <Wallet pubkey={e.pubkey} />
                    </td>
                    <td className={td}>
                      {e.role}
                      {e.campaignId ? <span className="text-white/60"> · campaign {e.campaignId}</span> : null}
                    </td>
                    <td className={td}>
                      <Pill tone={e.action === "grant" ? "pass" : "fail"}>{e.action}</Pill>
                    </td>
                    <td className={td}>{e.via === "script" || e.actor === null ? "script" : <Wallet pubkey={e.actor} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logCut !== null ? (
          <p className="text-[12.5px] text-white/60">Showing the {logCut} newest entries. Older entries stay in the access log table.</p>
        ) : null}
      </section>
    </div>
  );
}
