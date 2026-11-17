import type { ReactNode } from "react";
import { cx } from "./cx";

export function Eyebrow({
  as: Tag = "p",
  className,
  children,
}: {
  as?: "p" | "span" | "div" | "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={cx("font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted", className)}>{children}</Tag>;
}
