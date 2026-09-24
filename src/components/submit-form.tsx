"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { publicEnv } from "@/config/public-env";
import { submissionUrlSchema } from "@/domain/submission-url";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { HashChip } from "@/components/ui/hash-chip";

/** Below this many characters a half-typed link is not called wrong yet. */
const HINT_AFTER = 12;

/**
 * Submit gate: `valid` uses the same schema the server applies
 * (domain/submission-url.ts; the server still re-checks), `wrong` says whether
 * to show the wrong-link hint.
 */
export function urlGate(value: string): { valid: boolean; wrong: boolean } {
  const valid = submissionUrlSchema.safeParse(value).success;
  return { valid, wrong: !valid && value.trim().length > HINT_AFTER };
}

export function SubmitForm({ campaignSlug, payTo }: { campaignSlug: string; payTo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const hintId = useId();
  const inputId = useId();

  const { valid, wrong } = urlGate(value);

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
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor={inputId} className="mt-4 block text-[13px] font-medium text-text-2">
        Link to your post on X
      </label>
      <div
        className={cx(
          "mt-2 flex h-[52px] items-center gap-2.5 rounded-[14px] border bg-sunken px-3.5 transition-[border-color,box-shadow] duration-200",
          "focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
          wrong ? "border-fail-line" : "border-line-strong",
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0 fill-muted" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <input
          id={inputId}
          name="workUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://x.com/you/status/…"
          aria-invalid={wrong || undefined}
          aria-describedby={hintId}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cx("shrink-0 stroke-pass transition-opacity duration-200", valid ? "opacity-100" : "opacity-0")}
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      </div>
      <p id={hintId} aria-live="polite" className={cx("mt-2 min-h-[18px] text-[12.5px]", wrong ? "text-fail" : "text-muted")}>
        {wrong ? "That isn't an X post link. Copy it from the post's share menu." : "Only x.com or twitter.com status links."}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-fail">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!valid} busy={busy} busyLabel="Submitting…" className="mt-3.5 h-[52px] w-full text-[15.5px]">
        Submit for review
      </Button>
      <p className="mt-3 text-[12.5px] text-muted">One submission per wallet. The post must stay public until the campaign closes.</p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4 text-[13px] text-muted">
        <span>Paid in USDC to</span>
        <HashChip value={payTo} head={4} tail={4} href={publicEnv.explorerAccountUrl(payTo)} />
      </div>
    </form>
  );
}
