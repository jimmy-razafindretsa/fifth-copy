"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { EmbedFrame, hasWebGL2 } from "@/components/ui";
import styles from "./profile.module.css";

/** What the stage shows: the clerk embed, or the viewer's own picture (no outfit, no WebGL2, still). */
export function stageView({
  clerkSrc,
  still,
  webgl,
}: {
  clerkSrc: string | null;
  still: boolean;
  webgl: boolean | null;
}): "clerk" | "picture" {
  return clerkSrc === null || still || webgl !== true ? "picture" : "clerk";
}

let probed: boolean | undefined;
const probe = () => (probed ??= hasWebGL2());
const noSubscribe = () => () => {};

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
  // null on the server and while hydrating (the picture shows then), the probe's answer after
  const webgl = useSyncExternalStore(noSubscribe, probe, () => null);
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
