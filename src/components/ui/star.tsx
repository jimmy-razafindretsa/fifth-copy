import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import styles from "./star.module.css";

export type StarTone = "red" | "ink" | "gold" | "paper" | "faintRed" | "faintInk" | "faintPaper";

const TONES: Record<StarTone, string> = {
  red: styles.red!,
  ink: styles.ink!,
  gold: styles.gold!,
  paper: styles.paper!,
  faintRed: styles.faintRed!,
  faintInk: styles.faintInk!,
  faintPaper: styles.faintPaper!,
};

type Props = {
  size: number;
  tone: StarTone;
  /** fcSpin period in seconds (bible 8: 14 to 90); omitted, the star is printed still (#932). */
  spin?: number;
  /** A still star's tilt in degrees (the Personnel file's stage stars, #932). */
  rotate?: number;
  /** Absolute position inside the section (bible 6: scattered, never over text). */
  at?: Pick<CSSProperties, "top" | "right" | "bottom" | "left" | "zIndex" | "opacity">;
  className?: string;
};

/** A decorative star (design bible 6): spinning, or printed still at a tilt. */
export function Star({ size, tone, spin, rotate = 0, at, className }: Props) {
  const motion: CSSProperties =
    spin === undefined ? { transform: `rotate(${rotate}deg)` } : { animationDuration: `${spin}s` };
  return (
    <div
      aria-hidden="true"
      data-star-still={spin === undefined ? "" : undefined}
      className={cn(styles.star, TONES[tone], spin === undefined && styles.still, className)}
      style={{ width: size, height: size, ...motion, ...at }}
    />
  );
}
