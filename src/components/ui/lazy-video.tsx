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
 * (#28) it has no source at all: it never plays and shows the poster. `data-feed`: idle (server),
 * armed (hydrated), near (within the margin; sources written unless motion is reduced).
 */
export function LazyVideo({ poster, sources, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const hydrated = useHydrated();
  const near = useNearViewport(ref);
  const visible = useInViewport(ref);
  const reduced = useReducedMotion();
  const live = near && !reduced;
  const key = live ? sources.map((s) => s.src).join(" ") : "";

  // new sources, or none (reduced motion): reload, which also puts the poster back
  const loaded = useRef("");
  useEffect(() => {
    const video = ref.current;
    if (!video || loaded.current === key) return;
    loaded.current = key;
    video.load();
  }, [key]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !live) return;
    if (visible) {
      // React does not render the `muted` attribute; autoplay policies read the property
      video.muted = true;
      video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  }, [live, visible, key]);

  return (
    <video
      ref={ref}
      className={cn(styles.video, className)}
      poster={poster}
      muted
      loop
      playsInline
      preload={live ? "auto" : "none"}
      aria-hidden="true"
      data-feed={!hydrated ? "idle" : near ? "near" : "armed"}
    >
      {live && sources.map(({ src, type }) => <source key={src} src={src} type={type} />)}
    </video>
  );
}
