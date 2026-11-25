"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { PROFILE_LIMITS, profilePath, TELEGRAM_PATTERN } from "@/domain/profile";

const field =
  "mt-2 w-full rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3.5 text-[15px] text-text outline-none transition-colors duration-200 placeholder:text-white/25 hover:border-white/20 focus-visible:border-accent focus-visible:outline-none";
const legend = "font-display text-[1.6rem] leading-none";
const labelText = "font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/60";

export interface CountryOption {
  code: string;
  name: string;
}

export interface ProfileFields {
  displayName: string;
  bio: string;
  telegram: string;
  country: string;
  city: string;
}

type ErrorBody = { message?: string; details?: { issues?: Array<{ path: unknown[]; message: string }> } };

async function send(method: "PUT" | "POST", body: unknown): Promise<void> {
  const res = await fetch("/api/profile", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return;
  const json = (await res.json().catch(() => null)) as ErrorBody | null;
  const issue = json?.details?.issues?.[0];
  throw new Error(issue ? `${issue.path.join(".")}: ${issue.message}` : (json?.message ?? `request failed (${res.status})`));
}

/**
 * The profile form. "Later" appears while no name is saved: it records that
 * the wallet was asked and goes back to `next`. The limits mirror
 * `profileSchema`; the server checks them again.
 */
export function ProfileForm({
  pubkey,
  next,
  saved,
  countries,
  initial,
}: {
  pubkey: string;
  /** Already sanitized by the page; null when the form was opened from the menu. */
  next: string | null;
  saved: boolean;
  countries: CountryOption[];
  initial: ProfileFields;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"save" | "later" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function act(kind: "save" | "later", work: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setDone(false);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // Checked trimmed, as the server does: a pasted handle with spaces around it is still a handle.
    const telegram = String(f.get("telegram") ?? "").trim();
    if (telegram !== "" && !TELEGRAM_PATTERN.test(telegram)) {
      setError("Telegram: 5–32 letters, digits or underscores, starting with a letter and not ending with an underscore.");
      return;
    }
    const body = {
      displayName: f.get("displayName"),
      bio: f.get("bio"),
      telegram,
      country: f.get("country"),
      city: f.get("city"),
    };
    void act("save", async () => {
      await send("PUT", body);
      if (next) {
        router.push(next);
      } else {
        setDone(true);
      }
      router.refresh();
    });
  }

  function onLater() {
    void act("later", async () => {
      await send("POST", { action: "later" });
      router.push(next ?? "/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-[720px] space-y-6 rounded-[30px] border border-white/[0.07] bg-[#0d0d0d] p-5 sm:p-8">
      <fieldset className="space-y-5">
        <legend className={legend} style={{ fontVariationSettings: '"wdth" 88, "wght" 800' }}>
          Public
        </legend>
        <label className="block">
          <span className={labelText}>Display name</span>
          <input
            name="displayName"
            required
            maxLength={PROFILE_LIMITS.displayName}
            defaultValue={initial.displayName}
            autoComplete="nickname"
            placeholder="How contributors and funders see you"
            className={field}
          />
        </label>
        <label className="block">
          <span className={labelText}>Bio</span>
          <textarea
            name="bio"
            maxLength={PROFILE_LIMITS.bio}
            rows={3}
            defaultValue={initial.bio}
            placeholder="One or two lines about what you build or write"
            className={cx(field, "leading-relaxed")}
          />
        </label>
      </fieldset>

      <hr className="border-white/[0.07]" />

      <fieldset className="space-y-5">
        <legend className={legend} style={{ fontVariationSettings: '"wdth" 88, "wght" 800' }}>
          Private
        </legend>
        <p className="-mt-3 text-[13.5px] text-white/55">Only you and the Proofwork operator see your Telegram, city and country. They never appear on your public page.</p>
        <label className="block">
          <span className={labelText}>Telegram</span>
          <input
            name="telegram"
            defaultValue={initial.telegram}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@username"
            className={field}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelText}>City</span>
            <input name="city" maxLength={PROFILE_LIMITS.city} defaultValue={initial.city} autoComplete="address-level2" className={field} />
          </label>
          <label className="block">
            <span className={labelText}>Country</span>
            <select name="country" defaultValue={initial.country} className={cx(field, "h-[54px] py-0")}>
              <option value="">Not set</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-[13px] font-medium text-fail">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-[14px] text-white/75">
          Saved.{" "}
          <Link href={profilePath(pubkey)} className="font-semibold text-accent underline-offset-4 hover:underline">
            View your public page →
          </Link>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy === "save"} busyLabel="Saving…" disabled={busy !== null}>
          Save
        </Button>
        {saved ? null : (
          <Button variant="secondary" busy={busy === "later"} busyLabel="Skipping…" disabled={busy !== null} onClick={onLater}>
            Later
          </Button>
        )}
        {saved && !done ? (
          <Link href={profilePath(pubkey)} className="ml-auto text-[13.5px] font-medium text-white/60 underline-offset-4 hover:text-text hover:underline">
            Your public page →
          </Link>
        ) : null}
      </div>
    </form>
  );
}
