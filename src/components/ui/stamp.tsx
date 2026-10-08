"use client";

import { type AnimationEvent, type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "./motion";
import styles from "./stamp.module.css";

/**
 * Stamp angles: R29 -6 to +6 degrees, inside bible 7.3's -8 to +7; `auto` stays at least 2 degrees off
 * level ("always a little crooked"). The fallback -6 is the shipped HOST and FILE NOT FOUND angle.
 */
export const STAMP_ANGLE = { min: -6, max: 6, crooked: 2, fallback: -6 } as const;

/** Clamps a stamp angle to -6..6 degrees; a non-finite value falls back to -6. */
export function clampRotation(deg: number): number {
  if (!Number.isFinite(deg)) return STAMP_ANGLE.fallback;
  return Math.min(STAMP_ANGLE.max, Math.max(STAMP_ANGLE.min, deg));
}

/** FNV-1a over the seed's string form: a tiny deterministic hash (no dependency, no RNG). */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The `auto` angle for a seed: same seed, same angle; 2 <= |angle| <= 6, either direction. */
export function rotationFromSeed(seed: string | number): number {
  const h = hash(String(seed));
  const unit = (h >>> 1) / 2 ** 31; // [0, 1)
  const span = STAMP_ANGLE.max - STAMP_ANGLE.crooked;
  const magnitude = Math.round((STAMP_ANGLE.crooked + span * unit) * 100) / 100;
  return h & 1 ? magnitude : -magnitude;
}

export type StampRotation = number | "auto";

/** The resolved angle in degrees for a `rotation` prop and its `seed`. */
export function stampAngle(rotation: StampRotation, seed: string | number | undefined): number {
  return rotation === "auto" ? rotationFromSeed(seed ?? "") : clampRotation(rotation);
}

export type StampTone = "red" | "ink";
export type StampSize = "sm" | "md" | "lg";

const TONE: Record<StampTone, string> = {
  red: styles.red!,
  ink: styles.ink!,
};

// Literal class strings: Tailwind 4 only emits utilities it finds as complete strings.
const SIZE: Record<StampSize, { line: string; box: string }> = {
  sm: { line: "type-display-sm", box: styles.sm! },
  md: { line: "type-display-md", box: styles.md! },
  lg: { line: "type-display-lg", box: styles.lg! },
};

export type StampProps = {
  /** The headline, then an optional second line (bilingual stamps: `ОБГОН! · OVERTAKE` / `DÉPASSEMENT`). */
  lines: readonly [ReactNode, ReactNode?];
  /** `red` (default): link-role text on a primary rule; `ink`: fg text and rule. */
  tone?: StampTone;
  size?: StampSize;
  /** Degrees clamped to -6..6 (default -6), or `"auto"`: a deterministic angle from `seed`. */
  rotation?: StampRotation;
  seed?: string | number;
  /** Live region role: `status` (default), `alert`, or `null` for a static badge. */
  role?: "status" | "alert" | null;
  /** Fires once per mount when the slam has landed (at once under reduced motion). */
  onSettled?: () => void;
  className?: string;
};

/**
 * A rubber stamp (design bible 7.3, 8): a crooked two-line label in a 4px double rule that slams in once
 * (`fcSlam`) and simply appears under reduced motion. Presentation only; callers own the text and when
 * to mount it (ADR 0010, 0013).
 */
export function Stamp({
  lines,
  tone = "red",
  size = "md",
  rotation = STAMP_ANGLE.fallback,
  seed,
  role = "status",
  onSettled,
  className,
}: StampProps) {
  const reduced = useReducedMotion();
  const settled = useRef(false);
  const callback = useRef(onSettled);
  useEffect(() => {
    callback.current = onSettled;
  }, [onSettled]);

  const settle = () => {
    if (settled.current) return;
    settled.current = true;
    callback.current?.();
  };

  // Under reduce the animation is `none`, so `animationend` never fires: settle from here instead.
  useEffect(() => {
    if (reduced && !settled.current) {
      settled.current = true;
      callback.current?.();
    }
  }, [reduced]);

  // A server-rendered stamp can land before hydration attaches `onAnimationEnd`: settle at mount when
  // no slam is running any more (`getAnimations` flushes style first, so a fresh slam is seen running).
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const running = box.current?.getAnimations?.().some((a) => a.playState === "running");
    if (running === false && !settled.current) {
      settled.current = true;
      callback.current?.();
    }
  }, []);

  const angle = stampAngle(rotation, seed);
  const [first, second] = lines;
  return (
    <span
      ref={box}
      role={role ?? undefined}
      data-stamp-tone={tone}
      data-stamp-size={size}
      data-stamp-angle={angle}
      className={cn(styles.stamp, TONE[tone], SIZE[size].box, className)}
      style={{ "--stamp-angle": `${angle}deg` } as CSSProperties}
      onAnimationEnd={(e: AnimationEvent<HTMLSpanElement>) => {
        if (e.target === e.currentTarget) settle();
      }}
    >
      <span className={SIZE[size].line}>{first}</span>
      {second !== undefined && second !== null && second !== false && (
        <span className="type-label">{second}</span>
      )}
    </span>
  );
}
