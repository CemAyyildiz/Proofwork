"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AppealButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function appeal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/appeal`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message ?? "failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" disabled={busy} onClick={appeal} className="rounded border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50">
        {busy ? "Requesting…" : "Request one re-review"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
