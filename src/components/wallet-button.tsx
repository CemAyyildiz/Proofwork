"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login, logout } from "@/wallet/kit";

export function WalletButton({ pubkey }: { pubkey: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "wallet error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
      {pubkey ? (
        <>
          <code className="rounded bg-neutral-100 px-2 py-1 text-xs">{pubkey.slice(0, 4)}…{pubkey.slice(-4)}</code>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(logout)}
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(login)}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}
