"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { publicEnv } from "@/config/public-env";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** True when this item owns the current pathname. */
  match: (pathname: string) => boolean;
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);

const CAMPAIGNS: NavItem = {
  href: "/campaigns",
  label: "Campaigns",
  match: under("/campaigns"),
  icon: (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18" />
    </svg>
  ),
};

const REVIEW: NavItem = {
  href: "/review",
  label: "Review",
  match: under("/review"),
  icon: (
    <svg {...iconProps}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
};

const ADMIN: NavItem = {
  href: "/admin",
  label: "Admin",
  match: under("/admin"),
  icon: (
    <svg {...iconProps}>
      <path d="M12 3l8 3v6c0 4.6-3.2 7.9-8 9-4.8-1.1-8-4.4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
};

const EXPLORE: NavItem = {
  href: "/explore",
  label: "Explore",
  match: (p) => p === "/explore" || p.startsWith("/c/"),
  icon: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </svg>
  ),
};

const HOME: NavItem = {
  href: "/",
  label: "Home",
  match: (p) => p === "/",
  icon: (
    <svg {...iconProps}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
};

export interface WorkspaceNavProps {
  /**
   * The /campaigns item, for any signed-in wallet: "manage" for a funder or
   * the owner of a funded campaign, "request" for a wallet that would find the
   * funder access form there, null when signed out.
   */
  campaigns: "manage" | "request" | null;
  /** Role flags come from the server session; the nav never decides access itself. */
  reviewer: boolean;
  /** Admin: the `ops` wallet, or a wallet that is the dispute resolver of a campaign awaiting its return. */
  admin: boolean;
  /** "side" is the ≥ lg workspace rail with group headings; "top" is the compact row of the public top bar. Below lg the workspace uses `WorkspaceMenu`. */
  variant: "side" | "top";
  /** Include Home in the Public group. Off in the public top bar, where the logo already links home. */
  showPublic?: boolean;
}

type ItemProps = Pick<WorkspaceNavProps, "campaigns" | "reviewer" | "admin" | "showPublic">;

/** The items a wallet sees, in the sidebar's two groups. */
function navGroups({ campaigns, reviewer, admin, showPublic = true }: ItemProps): { workspace: NavItem[]; pub: NavItem[] } {
  const campaignsItem = campaigns === "manage" ? CAMPAIGNS : campaigns === "request" ? { ...CAMPAIGNS, label: "Run a campaign" } : null;
  const workspace = [campaignsItem, reviewer ? REVIEW : null, admin ? ADMIN : null].filter((i): i is NavItem => i !== null);
  return { workspace, pub: showPublic ? [EXPLORE, HOME] : [EXPLORE] };
}

export function WorkspaceNav({ variant, ...props }: WorkspaceNavProps) {
  const pathname = usePathname();
  const { workspace, pub } = navGroups(props);

  if (variant === "top") {
    const items = [...workspace, ...pub];
    if (items.length === 0) return null;
    return (
      <nav aria-label="Main" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {items.map((item) => (
          <TopLink key={item.href} item={item} active={item.match(pathname)} />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      <Groups workspace={workspace} pub={pub} pathname={pathname} />
    </nav>
  );
}

/**
 * The workspace nav below lg: a Menu button in the top bar that opens the
 * sidebar's groups in a sheet under the bar, so no item is cut off on a phone.
 * Escape, a click or tap outside, focus moving out of it, or a link inside it
 * closes it, and so does a change of page (pathname).
 */
export function WorkspaceMenu(props: ItemProps) {
  const pathname = usePathname();
  const { workspace, pub } = navGroups(props);
  // Open for the pathname it was opened on: moving to another page closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenOn(null);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <nav
      ref={root}
      aria-label="Main"
      onBlur={(e) => {
        // Tabbing past the last item leaves the panel; it must not stay open over the page.
        if (open && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOpenOn(null);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Menu"
        onClick={() => setOpenOn(open ? null : pathname)}
        className={cx(
          "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors duration-200",
          open ? "border-accent bg-accent text-accent-ink" : "border-white/15 text-text hover:bg-white/5",
        )}
      >
        <svg {...iconProps}>{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}</svg>
        <span className="hidden min-[400px]:inline">Menu</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest("a")) setOpenOn(null);
        }}
        className="absolute inset-x-0 top-full h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/10 bg-canvas px-5 pb-10 pt-4 md:px-10"
      >
        <Groups workspace={workspace} pub={pub} pathname={pathname} tall />
        <p className="mt-10 flex items-center gap-2 px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          {publicEnv.isMainnet ? "Stellar mainnet · real USDC" : "Stellar testnet · USDC here is not real money"}
        </p>
      </div>
    </nav>
  );
}

function Groups({ workspace, pub, pathname, tall = false }: { workspace: NavItem[]; pub: NavItem[]; pathname: string; tall?: boolean }) {
  return (
    <>
      {workspace.length > 0 ? (
        <>
          <GroupHeading>Workspace</GroupHeading>
          {workspace.map((item, i) => (
            <SideLink key={item.href} item={item} index={i} active={item.match(pathname)} tall={tall} />
          ))}
        </>
      ) : null}
      {pub.length > 0 ? (
        <>
          <GroupHeading>Public</GroupHeading>
          {pub.map((item, i) => (
            <SideLink key={item.href} item={item} index={workspace.length + i} active={item.match(pathname)} tall={tall} />
          ))}
        </>
      ) : null}
    </>
  );
}

function GroupHeading({ children }: { children: string }) {
  return <p className="px-3 pb-1.5 pt-5 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-white/35 first:pt-1">{children}</p>;
}

/** Sidebar item: the current page carries the yellow marker. In the phone sheet the items are set in the display face. */
function SideLink({ item, index, active, tall }: { item: NavItem; index: number; active: boolean; tall: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      style={tall ? { fontVariationSettings: active ? `"wdth" 80, "wght" 850` : `"wdth" 80, "wght" 500` } : undefined}
      className={cx(
        "group/nav relative flex items-center rounded-full transition-colors duration-200",
        tall ? "min-h-14 gap-4 px-3 font-display text-[34px] leading-none" : "gap-3 py-2.5 pl-4 pr-3 text-[14.5px] font-medium",
        active ? "text-text" : "text-white/50 hover:text-text",
        !tall && (active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"),
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute left-1 top-1/2 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-[height,opacity] duration-300 ease-expo",
          tall ? "left-0 h-0" : active ? "h-5 opacity-100" : "h-0 opacity-0",
        )}
      />
      {tall ? (
        <span aria-hidden="true" className={cx("w-6 font-mono text-[11px]", active ? "text-accent" : "text-white/30")}>
          {String(index + 1).padStart(2, "0")}
        </span>
      ) : (
        <span aria-hidden="true" className={cx("transition-colors", active ? "text-accent" : "text-white/35 group-hover/nav:text-white/70")}>
          {item.icon}
        </span>
      )}
      {item.label}
    </Link>
  );
}

/** Public top bar item: compact, the current page underlined in yellow. */
function TopLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors duration-200 md:h-9",
        active ? "bg-white/[0.06] text-text" : "text-white/55 hover:bg-white/[0.04] hover:text-text",
      )}
    >
      <span className={cx("hidden sm:inline", active ? "text-accent" : "opacity-70")}>{item.icon}</span>
      {item.label}
    </Link>
  );
}
