"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "./motion";
import { useInViewport, useNearViewport } from "./use-near-viewport";
import styles from "./lazy-video.module.css";

export type VideoSource = { src: string; type: string };

type Props = {
  poster: string;
  /** In preference order; changing them swaps the clip (the new one loads, the old one stops). */
  sources: VideoSource[];
  className?: string;
};

const noop = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

/**
 * A decorative, muted, looping video (the landing live feed, bible 7.8). The server renders the poster
 * only; the sources are written once the video comes near the viewport (same margin as `EmbedFrame`),
 * so nothing downloads before. It plays while on screen and pauses off screen. Under reduced motion
 * (#28) it never plays and shows the poster. `data-feed`: idle (server), armed (hydrated), near
 * (sources written).
 */
export function LazyVideo({ poster, sources, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const hydrated = useHydrated();
  const near = useNearViewport(ref);
  const visible = useInViewport(ref);
  const reduced = useReducedMotion();
  const key = sources.map((s) => s.src).join(" ");

  // a new clip (or a switch to reduced motion): reload, which also puts the poster back
  useEffect(() => {
    const video = ref.current;
    if (video && near) video.load();
  }, [near, key, reduced]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !near) return;
    if (visible && !reduced) {
      // React does not render the `muted` attribute; autoplay policies read the property
      video.muted = true;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [near, visible, reduced, key]);

  return (
    <video
      ref={ref}
      className={cn(styles.video, className)}
      poster={poster}
      muted
      loop
      playsInline
      preload={near && !reduced ? "auto" : "none"}
      aria-hidden="true"
      data-feed={!hydrated ? "idle" : near ? "near" : "armed"}
    >
      {near && sources.map(({ src, type }) => <source key={src} src={src} type={type} />)}
    </video>
  );
}
