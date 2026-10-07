import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Docket (bible 7.4): newsprint ground, 2px ink rule, no radius, flat. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-2 border-fg bg-surface p-4 md:p-6", className)} {...rest} />;
}
