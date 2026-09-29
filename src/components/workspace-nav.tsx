"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  /** Role flags come from the server session; the nav never decides access itself. */
  funder: boolean;
  reviewer: boolean;
  /** "side" is the ≥ lg rail with group headings; "top" is the compact row for narrow screens and the public bar. */
  variant: "side" | "top";
  /** Include Home in the Public group. Off in the public top bar, where the logo already links home. */
  showPublic?: boolean;
}

export function WorkspaceNav({ funder, reviewer, variant, showPublic = true }: WorkspaceNavProps) {
  const pathname = usePathname();
  const workspace = [funder ? CAMPAIGNS : null, reviewer ? REVIEW : null].filter((i): i is NavItem => i !== null);
  const pub = showPublic ? [EXPLORE, HOME] : [EXPLORE];

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
      {workspace.length > 0 ? (
        <>
          <GroupHeading>Workspace</GroupHeading>
          {workspace.map((item) => (
            <NavLink key={item.href} item={item} active={item.match(pathname)} />
          ))}
        </>
      ) : null}
      {pub.length > 0 ? (
        <>
          <GroupHeading>Public</GroupHeading>
          {pub.map((item) => (
            <NavLink key={item.href} item={item} active={item.match(pathname)} />
          ))}
        </>
      ) : null}
    </nav>
  );
}

function GroupHeading({ children }: { children: string }) {
  return (
    <p className="px-2.5 pb-2 pt-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{children}</p>
  );
}

function NavLink({ item, active, compact = false }: { item: NavItem; active: boolean; compact?: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center rounded-[10px] text-sm font-medium transition-colors duration-200",
        compact ? "h-11 md:h-9 shrink-0 gap-2 px-3" : "gap-[11px] px-2.5 py-[9px]",
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
