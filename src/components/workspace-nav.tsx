"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** True when this item owns the current pathname. */
  match: (pathname: string) => boolean;
}

const iconProps = {
  width: 17,
  height: 17,
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
          <NavLink key={item.href} item={item} active={item.match(pathname)} compact />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      <Groups workspace={workspace} pub={pub} pathname={pathname} />
    </nav>
  );
}

/**
 * The workspace nav below lg: a Menu button in the top bar that opens the
 * sidebar's groups in a panel under the bar, so no item is cut off on a phone.
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
        className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-sm font-medium text-text-2 transition-colors duration-200 hover:bg-white/3 hover:text-text"
      >
        <svg {...iconProps}>{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
        <span className="hidden min-[400px]:inline">Menu</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest("a")) setOpenOn(null);
        }}
        className="absolute inset-x-0 top-full flex max-h-[calc(100dvh-4rem)] flex-col gap-0.5 overflow-y-auto border-b border-line bg-canvas px-[18px] pb-4 md:px-10"
      >
        <Groups workspace={workspace} pub={pub} pathname={pathname} tall />
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
          {workspace.map((item) => (
            <NavLink key={item.href} item={item} active={item.match(pathname)} tall={tall} />
          ))}
        </>
      ) : null}
      {pub.length > 0 ? (
        <>
          <GroupHeading>Public</GroupHeading>
          {pub.map((item) => (
            <NavLink key={item.href} item={item} active={item.match(pathname)} tall={tall} />
          ))}
        </>
      ) : null}
    </>
  );
}

function GroupHeading({ children }: { children: string }) {
  return (
    <p className="px-2.5 pb-2 pt-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{children}</p>
  );
}

function NavLink({ item, active, compact = false, tall = false }: { item: NavItem; active: boolean; compact?: boolean; tall?: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center rounded-[10px] text-sm font-medium transition-colors duration-200",
        compact ? "h-11 md:h-9 shrink-0 gap-2 px-3" : tall ? "min-h-11 gap-[11px] px-2.5" : "gap-[11px] px-2.5 py-[9px]",
        active
          ? "bg-white/5 text-text shadow-[inset_0_0_0_1px_var(--color-line)]"
          : "text-muted hover:bg-white/3 hover:text-text",
      )}
    >
      <span className={cx("opacity-85", compact && "hidden sm:inline")}>{item.icon}</span>
      {item.label}
    </Link>
  );
}
