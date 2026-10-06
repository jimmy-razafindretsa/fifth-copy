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
  /** fcSpin period in seconds (bible 8: 14 to 90). */
  spin: number;
  /** Absolute position inside the section (bible 6: scattered, never over text). */
  at?: Pick<CSSProperties, "top" | "right" | "bottom" | "left" | "zIndex" | "opacity">;
  className?: string;
};

/** A decorative spinning star (design bible 6). */
export function Star({ size, tone, spin, at, className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn(styles.star, TONES[tone], className)}
      style={{ width: size, height: size, animationDuration: `${spin}s`, ...at }}
    />
  );
}
