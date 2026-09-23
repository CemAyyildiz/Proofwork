"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

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
    <div className="mt-3">
      <Button variant="secondary" size="sm" busy={busy} busyLabel="Requesting…" onClick={appeal}>
        Request a re-review
      </Button>
      <p className="mt-2 text-[12.5px] text-muted">You can do this once while the campaign is open.</p>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
