import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

// Printed look (#15, bible 7.1 label-button family): flat fills, 2px ink rules, no radius, no offset;
// pressed = banner fill and the label 1px down. Ghost is the link-like extension (bible 7.1, #15).
const variants = {
  primary:
    "border-2 border-fg bg-primary text-primary-fg enabled:hover:bg-primary-hover enabled:active:bg-pressed",
  secondary: "border-2 border-fg bg-transparent text-fg enabled:hover:bg-surface",
  ghost: "border-0 bg-transparent text-fg underline-offset-4 enabled:hover:underline",
  danger: "border-2 border-fg bg-pressed text-primary-fg",
} as const;

// Labels are the type-label role (bible 7.1 label buttons: Oswald 600, caps); size sets only the size.
const sizes = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "type-label inline-flex items-center justify-center transition-colors enabled:active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size="sm" label="" />}
      {children}
    </button>
  );
}
