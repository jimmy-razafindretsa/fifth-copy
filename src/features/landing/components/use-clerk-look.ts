"use client";

import { type RefObject, useEffect } from "react";
import { lookMessage } from "../embed-messages";

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * The clerk embed's head follows the cursor anywhere on the page (bible 10.2, 15: `fc-look`, throttled
 * with rAF), measured from the clerk's face (a third down the frame).
 */
export function useClerkLook(
  ref: RefObject<HTMLIFrameElement | null>,
  post: (message: unknown) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const move = (event: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height * 0.32;
        post(
          lookMessage(
            clamp((event.clientX - cx) / (window.innerWidth / 2)),
            clamp((event.clientY - cy) / (window.innerHeight / 2)),
          ),
        );
      });
    };
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [post, ref, enabled]);
}
