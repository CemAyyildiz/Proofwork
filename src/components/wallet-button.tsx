"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { publicEnv } from "@/config/public-env";
import { shortKey } from "@/lib/format";
import { login, logout, WalletCancelled } from "@/wallet/kit";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

const COPIED_MS = 1500;

const itemClass =
  "flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-sm font-medium text-text-2 hover:bg-white/5 hover:text-text focus-visible:bg-white/5 focus-visible:text-text";

export function WalletButton({
  pubkey,
  className,
  menuPlacement = "down",
}: {
  pubkey: string | null;
  className?: string;
  /** "up" opens the account menu above the button, for the sidebar foot. */
  menuPlacement?: "down" | "up";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      if (!(e instanceof WalletCancelled)) setError(e instanceof Error ? e.message : "wallet error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (copied === "idle") return;
    const t = setTimeout(() => setCopied("idle"), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  async function onCopy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("copied");
    } catch {
      // Clipboard access denied or unavailable: say so inline instead of pretending.
      setCopied("failed");
    }
  }

  return (
    <div ref={rootRef} className={cx("relative flex items-center gap-3", className)}>
      {error ? (
        <span role="alert" className="max-w-56 truncate text-[13px] text-fail/80" title={error}>
          {error}
        </span>
      ) : null}
      {pubkey ? (
        <>
          <button
            ref={triggerRef}
            type="button"
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-label={`Wallet ${pubkey}`}
            title={pubkey}
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 items-center md:h-[38px] gap-2.5 rounded-full border border-line-strong bg-surface pl-[5px] pr-3 font-mono text-[13px] font-medium text-text transition-colors duration-200 hover:bg-raised disabled:opacity-50"
          >
            <span aria-hidden="true" className="avatar-gradient h-7 w-7 rounded-full" />
            <span aria-hidden="true">{busy ? "Disconnecting…" : shortKey(pubkey)}</span>
          </button>
          {open ? (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="Wallet"
              onKeyDown={onMenuKeyDown}
              className={cx(
                "absolute z-50 w-56 rounded-lg border border-line-strong bg-raised p-1.5 shadow-2xl shadow-black/60",
                menuPlacement === "up" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2",
              )}
            >
              <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => onCopy(pubkey)}>
                Copy address
                <span className="font-mono text-[11px] text-muted" aria-live="polite">
                  {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : ""}
                </span>
              </button>
              <a
                role="menuitem"
                tabIndex={-1}
                href={publicEnv.explorerAccountUrl(pubkey)}
                target="_blank"
                rel="noreferrer"
                className={itemClass}
                onClick={() => setOpen(false)}
              >
                View on explorer
                <span aria-hidden="true" className="text-muted">
                  ↗
                </span>
              </a>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cx(itemClass, "text-fail hover:text-fail focus-visible:text-fail")}
                onClick={() => {
                  close();
                  void run(logout);
                }}
              >
                Disconnect
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <Button size="sm" busy={busy} busyLabel="Waiting for wallet…" onClick={() => run(login)}>
          Connect wallet
        </Button>
      )}
    </div>
  );
}
