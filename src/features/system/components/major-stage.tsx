"use client";

import { useEffect } from "react";
import { EmbedFrame, Star, useEmbedBridge } from "@/components/ui";
import styles from "./not-found.module.css";

/** The Major's embed (`docs/design/embeds/Fifth Copy The Major.html`, bible 10.3, 15). */
export const MAJOR_EMBED = "/3d/major.html";

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * The Major on a sun-ray stage. His head follows the cursor anywhere on the page (`fc-look`,
 * throttled with rAF); a click on him makes him lean in. Phones get his idle scan instead.
 */
export function MajorStage({ title, hint }: { title: string; hint: string }) {
  const { ref, post } = useEmbedBridge();

  useEffect(() => {
    let frame = 0;
    const move = (event: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height * 0.3;
        post({
          type: "fc-look",
          x: clamp((event.clientX - cx) / (window.innerWidth / 2)),
          y: clamp((event.clientY - cy) / (window.innerHeight / 2)),
        });
      });
    };
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [post, ref]);

  return (
    <div className={styles.stage}>
      <Star size={40} tone="red" spin={30} at={{ right: 28, top: 56, zIndex: 1 }} />
      <Star size={22} tone="gold" spin={22} at={{ right: 76, top: 104, zIndex: 1 }} />
      <Star size={120} tone="faintInk" spin={80} at={{ left: -30, bottom: 20, zIndex: 0 }} />
      <EmbedFrame ref={ref} src={MAJOR_EMBED} title={title} />
      <div className={styles.stageHint}>{hint}</div>
    </div>
  );
}
