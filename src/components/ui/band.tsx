import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Steep band angles (bible 6, from the print page bands at 36 and -38 degrees, bible 16). */
export const BAND_ANGLE = { min: 30, max: 45, fallback: 38 } as const;

/** Clamps a band angle to 30-45 degrees; a non-finite value falls back to 38. */
export function clampAngle(angle: number): number {
  if (!Number.isFinite(angle)) return BAND_ANGLE.fallback;
  return Math.min(BAND_ANGLE.max, Math.max(BAND_ANGLE.min, angle));
}

export type BandTone = "primary" | "pressed";

// Literal class strings: Tailwind 4 only emits utilities it finds as complete strings.
const FILL: Record<BandTone, string> = {
  primary: "bg-primary",
  pressed: "bg-pressed",
};

export type BandProps = {
  /** Degrees, clamped to 30-45 (default 38). */
  angle?: number;
  tone?: BandTone;
  /** Counter-rotates the children so they read level across the slanted band. */
  upright?: boolean;
  /** Sizes the clipping box (default `min-h-24`); the strip crosses it edge to edge. */
  className?: string;
  children?: ReactNode;
};

/**
 * A steep constructivist band (design bible 6, "steep band"): a flat red strip crossing its box edge
 * to edge, clipped by the box so it never overflows the page. Decorative without children.
 */
export function Band({
  angle = BAND_ANGLE.fallback,
  tone = "primary",
  upright,
  className,
  children,
}: BandProps) {
  const a = clampAngle(angle);
  const labelled = children !== undefined && children !== null && children !== false;
  return (
    <div
      role={labelled ? undefined : "presentation"}
      data-band-angle={a}
      className={cn("relative min-h-24 overflow-hidden", className)}
    >
      <div
        data-band-strip
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 flex min-h-12 w-[300%] items-center justify-center py-3",
          FILL[tone],
        )}
        style={{ transform: `translate(-50%, -50%) rotate(${a}deg)` }}
      >
        {labelled && (
          <div
            className="pointer-events-auto"
            data-band-upright={upright ? "" : undefined}
            style={upright ? { transform: `rotate(-${a}deg)` } : undefined}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
