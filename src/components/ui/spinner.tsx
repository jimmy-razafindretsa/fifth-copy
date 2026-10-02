import { cn } from "@/lib/cn";

export type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  /** Accessible label. Pass "" when the parent already announces the busy state. */
  label?: string;
  className?: string;
};

const sizes = { sm: "size-4 border-2", md: "size-6 border-2", lg: "size-10 border-[3px]" };

export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block animate-spin rounded-full border-current border-t-transparent",
        sizes[size],
        className,
      )}
    />
  );
}
