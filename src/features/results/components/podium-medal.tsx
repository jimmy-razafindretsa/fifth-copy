"use client";

import { useEffect, useSyncExternalStore } from "react";
import { EmbedFrame, hasWebGL2, Stamp, useEmbedBridge, useReducedMotion } from "@/components/ui";
import { medalEmbedSrc, medalVariantMessage, motionMessage } from "../embed-messages";
import type { MedalVariant } from "../view/dawn-report";
import styles from "./podium-medal.module.css";

/** What the slot shows: the live embed, or the gold stamp (no WebGL, or a still specimen). */
export function medalView({ still, webgl }: { still: boolean; webgl: boolean | null }) {
  return still || webgl === false ? "stamp" : "frame";
}

let probed: boolean | undefined;
const probe = () => (probed ??= hasWebGL2());
const noSubscribe = () => () => {};

export type PodiumMedalProps = {
  variant: MedalVariant;
  /** The embed's title (catalog `results.podium.medalTitle`). */
  title: string;
  /** The fallback stamp: `HERO OF PAPERWORK` / `HÉROS DE LA PAPERASSE`. */
  fallback: string;
  /** Render the stamp, never the frame (`/design`: a WebGL frame spinning on rAF has no stable baseline). */
  still?: boolean;
};

/**
 * One podium medal (#300 C4, bible 13, 15, ADR 0013): the medal embed in an `EmbedFrame` (mounted only
 * near the viewport), its metal set by `?variant=` for the first frame and by `fc-medal-variant` after,
 * the page's motion setting passed as `fc-motion` (the embed also reads the media query itself). Without
 * WebGL2 the slot shows the gold `HERO OF PAPERWORK` stamp instead of an empty frame.
 */
export function PodiumMedal({ variant, title, fallback, still = false }: PodiumMedalProps) {
  // null on the server and while hydrating (the frame stays idle then), the probe's answer after
  const webgl = useSyncExternalStore(noSubscribe, probe, () => null);
  const reduce = useReducedMotion();
  const { ref, post } = useEmbedBridge();
  const view = medalView({ still, webgl });

  useEffect(() => {
    const frame = ref.current;
    if (view !== "frame" || !frame) return;
    const send = () => {
      post(medalVariantMessage(variant));
      post(motionMessage(reduce));
    };
    send();
    frame.addEventListener("load", send);
    return () => frame.removeEventListener("load", send);
  }, [ref, post, variant, reduce, view]);

  if (view === "stamp") {
    return (
      <div className={styles.medal} data-medal={variant} data-medal-view="stamp">
        <Stamp tone="gold" size="sm" role={null} lines={[fallback]} className={styles.stamp} />
      </div>
    );
  }
  return (
    <div className={styles.medal} data-medal={variant} data-medal-view="frame">
      <EmbedFrame ref={ref} src={medalEmbedSrc(variant)} title={title} />
    </div>
  );
}
