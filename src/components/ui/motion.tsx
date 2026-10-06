"use client";

import { type ReactNode, useSyncExternalStore } from "react";

/**
 * The one motion setting (#28, design bible 8): the OS `prefers-reduced-motion`, or an explicit
 * `<html data-motion="reduce">` (set by the settings card #66 the way #19 sets `data-theme`). CSS reads
 * the same pair through the `--motion-*` tokens (docs/design/tokens.css); this hook is for motion that
 * lives in script (3D cameras, the bulb, swapped markup). The 3D embeds read it, never own it (ADR 0013).
 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Pure reader: reduce when the media query matches or the attribute says so. */
export function readReducedMotion(mediaMatches: boolean, attr: string | null): boolean {
  return mediaMatches || attr === "reduce";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

const read = () =>
  readReducedMotion(
    window.matchMedia(REDUCED_MOTION_QUERY).matches,
    document.documentElement.getAttribute("data-motion"),
  );

/**
 * True when motion must stop. SSR-safe: false on the server and during hydration (no mismatch), then
 * the live value; CSS durations are already 0ms under reduce, so that first frame moves nothing.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

type MotionSafeProps = { children: ReactNode; fallback?: ReactNode };

/** Presentational branch of `MotionSafe` (pure, unit-tested). */
export function MotionSafeView({
  reduced,
  children,
  fallback = null,
}: MotionSafeProps & { reduced: boolean }) {
  return <>{reduced ? fallback : children}</>;
}

/** Renders `children` only when motion is allowed, `fallback` (a still version) otherwise. */
export function MotionSafe({ children, fallback }: MotionSafeProps) {
  return (
    <MotionSafeView reduced={useReducedMotion()} fallback={fallback}>
      {children}
    </MotionSafeView>
  );
}
