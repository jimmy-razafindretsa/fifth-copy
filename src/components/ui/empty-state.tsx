import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  /** Primary next step, usually a <Button> or link. */
  action?: ReactNode;
  className?: string;
};

/** Nothing here yet: the dashed rule of the locked item card (bible 7.6), no radius. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 border-2 border-dashed border-border p-8 text-center",
        className,
      )}
    >
      <p className="type-display-sm text-fg">{title}</p>
      {description && <p className="type-body max-w-prose text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
