"use client";

import { useEffect, useSyncExternalStore } from "react";
import { EmbedFrame, hasWebGL2, Stamp, useEmbedBridge, useReducedMotion } from "@/components/ui";
import {
  medalVariantMessage,
  motionMessage,
  parseClerkReady,
  podiumClerkSrc,
  setCfgMessage,
  type Outfit,
} from "../embed-messages";
import type { MedalVariant } from "../view/dawn-report";
import styles from "./podium-clerk.module.css";

/** What the slot shows: the live embed, or the gold stamp (no WebGL, or a still specimen). */
export function clerkView({ still, webgl }: { still: boolean; webgl: boolean | null }) {
  return still || webgl === false ? "stamp" : "frame";
}

/** What the page posts the clerk on load (#688 C3): the medal, the outfit, the page's motion setting. */
export const clerkMessages = (variant: MedalVariant, outfit: Outfit, reduce: boolean) => [
  medalVariantMessage(variant),
  setCfgMessage(outfit),
  motionMessage(reduce),
];

let probed: boolean | undefined;
const probe = () => (probed ??= hasWebGL2());
const noSubscribe = () => () => {};

export type PodiumClerkProps = {
  variant: MedalVariant;
  /** The outfit the clerk wears (`ReportEntry.outfit`: saved, else the desk's). */
  outfit: Outfit;
  /** The embed's title (catalog `results.podium.medalTitle`). */
  title: string;
  /** The fallback stamp: `HERO OF PAPERWORK` / `HÉROS DE LA PAPERASSE`. */
  fallback: string;
  /** Render the stamp, never the frame (`/design`: a WebGL frame on rAF has no stable baseline). */
  still?: boolean;
  /** False holds the frame idle (no `src`) until the previous plinth is done (#688 C4). */
  mount?: boolean;
  /** Called on the clerk's first `fc-clerk` (drawn), or at once when the slot shows the stamp. */
  onReady?: () => void;
};

/**
 * One plinth's clerk (#688 C3, bible 14.4 "Plinth clerk", 13 "Chest pin", 15; ADR 0013, 0017): the podium
 * clerk embed in an `EmbedFrame` (mounted near the viewport, once `mount` allows), wearing `outfit` with
 * the `variant` medal pinned; both arrive as URL flags for the first frame and as `fc-setcfg` /
 * `fc-medal-variant` after, with the page's motion setting as `fc-motion`. Without WebGL2 (or `still`)
 * the slot shows the gold `HERO OF PAPERWORK` stamp; the stat cell names the player either way.
 */
export function PodiumClerk({
  variant,
  outfit,
  title,
  fallback,
  still = false,
  mount = true,
  onReady,
}: PodiumClerkProps) {
  // null on the server and while hydrating (the frame stays idle then), the probe's answer after
  const webgl = useSyncExternalStore(noSubscribe, probe, () => null);
  const reduce = useReducedMotion();
  const { ref, post } = useEmbedBridge(parseClerkReady, onReady);
  const view = clerkView({ still, webgl });

  useEffect(() => {
    if (view === "stamp") onReady?.();
  }, [view, onReady]);

  useEffect(() => {
    const frame = ref.current;
    if (view !== "frame" || !mount || !frame) return;
    const send = () => clerkMessages(variant, outfit, reduce).forEach(post);
    send();
    frame.addEventListener("load", send);
    return () => frame.removeEventListener("load", send);
  }, [ref, post, variant, outfit, reduce, view, mount]);

  if (view === "stamp") {
    return (
      <div className={styles.medal} data-medal={variant} data-medal-view="stamp">
        <Stamp tone="gold" size="sm" role={null} lines={[fallback]} className={styles.stamp} />
      </div>
    );
  }
  return (
    <div className={styles.medal} data-medal={variant} data-medal-view="frame">
      <EmbedFrame ref={ref} src={podiumClerkSrc(variant, outfit)} title={title} hold={!mount} />
    </div>
  );
}
