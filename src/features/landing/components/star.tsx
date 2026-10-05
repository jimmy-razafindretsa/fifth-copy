import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import styles from "./landing.module.css";

export type StarTone = "red" | "ink" | "gold" | "paper" | "faintRed" | "faintInk" | "faintPaper";

const TONES: Record<StarTone, string> = {
  red: styles.starRed!,
  ink: styles.starInk!,
  gold: styles.starGold!,
  paper: styles.starPaper!,
  faintRed: styles.starFaintRed!,
  faintInk: styles.starFaintInk!,
  faintPaper: styles.starFaintPaper!,
};

type Props = {
  size: number;
  tone: StarTone;
  /** fcSpin period in seconds (bible 8: 14 to 90). */
  spin: number;
  /** Absolute position inside the section (bible 6: scattered, never over text). */
  at?: Pick<CSSProperties, "top" | "right" | "bottom" | "left" | "zIndex" | "opacity">;
  className?: string;
};

/** A decorative spinning star (bible 6). */
export function Star({ size, tone, spin, at, className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn(styles.star, TONES[tone], className)}
      style={{ width: size, height: size, animationDuration: `${spin}s`, ...at }}
    />
  );
}
