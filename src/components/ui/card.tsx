import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Gradient hairline border for hero cards. */
  glow?: boolean;
}

export function Card({ glow = false, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={cx("relative rounded-xl border border-line bg-surface", glow && "card-glow", className)}>
      {children}
    </div>
  );
}
