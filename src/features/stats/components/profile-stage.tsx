"use client";

import type { ReactNode } from "react";
import { EmbedFrame, stageView, useWebGL2 } from "@/components/ui";
import styles from "./profile.module.css";

export type ProfileStageProps = {
  /** The clerk embed in the viewer's saved uniform, or null when nothing is saved. */
  clerkSrc: string | null;
  /** The embed's title (decorative frame: hidden from assistive tech either way). */
  title: string;
  /** The viewer's own picture: approved avatar, else the default portrait (server-rendered). */
  picture: ReactNode;
  /** `/design` specimens: always the picture (a WebGL frame has no stable baseline). */
  still?: boolean;
};

/**
 * The hero stage's photo slot (#932 C4, ADR 0013): the viewer's clerk in their saved uniform, a
 * decorative embed (no focus, no pointer), mounted near the viewport. The server render and a browser
 * without WebGL2 show the viewer's picture instead, so the page never depends on WebGL.
 */
export function ProfileStage({ clerkSrc, title, picture, still = false }: ProfileStageProps) {
  // null on the server and while hydrating (the picture shows then), the probe's answer after; the
  // Personnel file keeps its #932 behaviour under reduced motion (no reducedMotion input)
  const webgl = useWebGL2();
  const view = stageView({ clerkSrc, still, webgl });
  return (
    <div className={styles.slot} data-stage-view={view}>
      {view === "clerk" && clerkSrc !== null ? (
        <EmbedFrame src={clerkSrc} title={title} decorative className={styles.clerkFrame} />
      ) : (
        <div className={styles.picture}>{picture}</div>
      )}
    </div>
  );
}
