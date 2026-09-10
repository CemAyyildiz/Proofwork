"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SubmitForm({ campaignSlug }: { campaignSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const workUrl = String(new FormData(e.currentTarget).get("workUrl") ?? "");
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignSlug, workUrl }),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message ?? "failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        <span className="font-medium">Link to your post on X</span>
        <input
          name="workUrl"
          type="url"
          required
          placeholder="https://x.com/yourhandle/status/1234567890"
          pattern="https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,20}.*"
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
        {busy ? "Submitting…" : "Submit"}
      </button>
      <p className="text-xs text-neutral-500">One submission per wallet. The post must stay public until the campaign closes.</p>
    </form>
  );
}
