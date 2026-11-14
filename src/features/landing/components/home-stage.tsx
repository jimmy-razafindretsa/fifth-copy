"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { EmbedFrame, stageView, useReducedMotion, useWebGL2 } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./home.module.css";

const WIDE = "(min-width: 768px)";
const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const readWide = () => window.matchMedia(WIDE).matches;

export type HomeStageProps = {
  /** The clerk embed in the viewer's saved uniform (`clerkEmbedSrc`), the plain page when nothing is saved. */
  clerkSrc: string | null;
  title: string;
  /** The viewer's portrait (approved picture, else the default portrait), server-rendered. */
  picture: ReactNode;
  /** `/design` specimens: always the picture. */
  still?: boolean;
};

/**
 * The clerk stage (#946; bible "Home menu", 6, 10.1, 15; ADR 0013): the right half of the menu, red
 * ground, sun rays, an ink podium with a gold rim, and the viewer's clerk in 3D, mounted only after
 * hydration, at 768px and wider, with WebGL2 and without reduced motion (`stageView`, shared with the
 * Personnel file). Otherwise the portrait stands on the podium. Decorative: hidden from assistive tech,
 * no focus, no pointer.
 */
export function HomeStage({ clerkSrc, title, picture, still = false }: HomeStageProps) {
  const webgl = useWebGL2();
  const reducedMotion = useReducedMotion();
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const view = stageView({ clerkSrc, still, webgl, reducedMotion });
  const mountClerk = view === "clerk" && wide && clerkSrc !== null;
  return (
    <div
      className={cn(styles.stage, still && styles.stageStill)}
      aria-hidden="true"
      data-home-stage
      data-stage-view={view}
    >
      <div className={styles.rays} />
      <div className={styles.podium} />
      {mountClerk ? (
        <div className={styles.clerk}>
          <EmbedFrame src={clerkSrc} title={title} decorative className={styles.clerkFrame} />
        </div>
      ) : (
        <div className={styles.picture}>{picture}</div>
      )}
    </div>
  );
}
