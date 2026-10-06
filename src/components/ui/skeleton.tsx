import { cn } from "@/lib/cn";

/** Loading placeholder. Decorative: wrap a group of skeletons in an element with aria-busy. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse motion-reduce:animate-none rounded-md bg-surface-muted",
        className,
      )}
    />
  );
}
