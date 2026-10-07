import { cn } from "@/lib/cn";

/**
 * Loading placeholder: a flat block, no shimmer, no gradient, no pulse (bible 7.4 skeleton rows, 6).
 * Decorative: wrap a group of skeletons in an element with aria-busy.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("bg-surface-muted", className)} />;
}
