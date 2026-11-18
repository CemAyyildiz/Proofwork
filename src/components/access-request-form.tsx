"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";

/** Set on paper: black ink, white wells. */
const field =
  "mt-2 w-full rounded-[16px] border border-black/15 bg-white px-4 py-3 text-[15px] text-paper-ink placeholder:text-black/35 focus-visible:border-black focus-visible:outline-black";
const label = "block font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-black/65";

/**
 * Asks the operator for funder access: a team name and a note, nothing else.
 * The limits mirror `funderRequestSchema`; the server checks them again.
 */
export function AccessRequestForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teamId = useId();
  const noteId = useId();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/access/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team: f.get("team"), note: f.get("note") }),
      });
      const json = (await res.json()) as { message?: string; details?: { issues?: Array<{ path: unknown[]; message: string }> } };
      if (!res.ok) {
        const issue = json.details?.issues?.[0];
        throw new Error(issue ? `${issue.path.join(".")}: ${issue.message}` : (json.message ?? "failed"));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="text-paper-ink">
      <label htmlFor={teamId} className={label}>
        Team or project name
      </label>
      <input id={teamId} name="team" required minLength={2} maxLength={80} autoComplete="off" className={field} />
      <label htmlFor={noteId} className={`${label} mt-5`}>
        What do you plan to run?
      </label>
      <textarea
        id={noteId}
        name="note"
        required
        maxLength={500}
        rows={4}
        className={field}
        placeholder="The campaign you have in mind, roughly how many contributors and what budget."
      />
      <p className="mt-2 text-[12.5px] text-black/65">No email or other contact details. The operator answers on this page.</p>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] font-medium text-[#b42318]">
          {error}
        </p>
      ) : null}
      <Button type="submit" busy={busy} busyLabel="Sending…" className="mt-5">
        Request funder access
      </Button>
    </form>
  );
}
