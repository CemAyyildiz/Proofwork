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
  action: "grant" | "revoke";
  /** The ops wallet that acted; null when the change came from the script. */
  actor: string | null;
  via: "admin" | "script";
  at: string;
}

type Mutation = { action: "approve" | "reject"; requestId: string } | { action: "revoke"; pubkey: string };

const th = "whitespace-nowrap py-2 pr-4 text-left font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted";
const tdWrap = "py-3 pr-4 align-top";
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
export function AdminAccess({ pending, funders, log }: { pending: PendingRequestRow[]; funders: FunderAccessRow[]; log: AccessLogRow[] }) {
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
    <div className="space-y-10">
      {error ? (
        <p role="alert" className="text-sm text-fail">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">Pending requests</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No pending requests.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{r.team}</p>
                  <Wallet pubkey={r.pubkey} />
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text-2">{r.note}</p>
                <p className="mt-2 text-[12.5px] text-muted">Requested {r.requestedAt}</p>
                <div className="mt-3 flex flex-wrap gap-2.5">
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
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Funders</h2>
        {funders.length === 0 ? (
          <p className="text-sm text-muted">No wallet has funder access.</p>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className={`${tdWrap} min-w-[10rem]`}>{f.team ?? <span className="text-muted">granted with the script</span>}</td>
                    <td className={td}>{f.grantedAt}</td>
                    <td className="py-3 align-top">
                      {confirming === f.pubkey ? (
                        <div className="flex flex-wrap gap-2.5">
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
        <p className="text-[12.5px] text-muted">
          A revoked wallet can no longer create, deploy or fund a campaign. It keeps final approval, release and close on
          campaigns it already funded.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Access log</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted">No role has been granted or revoked yet.</p>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className={td}>{e.role}</td>
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
      </section>
    </div>
  );
}
