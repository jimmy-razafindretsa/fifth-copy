import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const tones = {
  info: "border-border bg-surface-muted text-fg",
  success: "border-success bg-success-surface text-fg",
  error: "border-danger bg-danger-surface text-fg",
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
      className={cn("rounded-md border p-4", tones[tone], className)}
    >
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-fg-muted">{children}</div>}
    </div>
  );
}
