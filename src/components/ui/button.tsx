import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** While true the button is disabled, shows `busyLabel` and runs the sheen. */
  busy?: boolean;
  /** The verb in progress, e.g. "Committing on-chain…". Falls back to the normal label. */
  busyLabel?: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "border border-line-strong bg-white/2 text-text hover:bg-white/5",
  danger: "border border-fail-line bg-transparent text-fail hover:bg-fail-soft",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-11 px-5 text-[14.5px] rounded-md",
  sm: "h-9 px-3.5 text-[13.5px] rounded-[10px]",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cx(
    "relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-semibold tracking-[-0.01em]",
    "transition-[transform,background-color,filter,opacity] duration-150 ease-expo active:scale-[0.97]",
    "disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  busyLabel,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClasses(variant, size, className)}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -translate-x-full animate-sheen bg-linear-100 from-transparent from-30% via-white/50 via-50% to-transparent to-70%"
        />
      ) : null}
      <span className="relative inline-flex items-center gap-2">{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}
