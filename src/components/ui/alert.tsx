import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// A docket row (bible 7.4, #15 extension): the tone lives in the ground, the rule is always 2px ink.
const tones = {
  info: "bg-surface-muted text-fg",
  success: "bg-success-surface text-fg",
  error: "bg-danger-surface text-fg",
} as const;

export type AlertProps = {
  tone?: keyof typeof tones;
  title: string;
  children?: ReactNode;
  className?: string;
};

/** Inline message. tone="error" uses role="alert" (announced immediately); others role="status". */
export function Alert({ tone = "info", title, children, className }: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("border-2 border-fg p-4", tones[tone], className)}
    >
      <p className="type-display-sm">{title}</p>
      {children && <div className="type-body mt-1 text-sm text-fg-muted">{children}</div>}
    </div>
  );
}
