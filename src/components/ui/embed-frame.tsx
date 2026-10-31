"use client";

import { useCallback, useRef, type Ref } from "react";
import { cn } from "@/lib/cn";
import styles from "./embed-frame.module.css";
import { useNearViewport } from "./use-near-viewport";

type Props = {
  src: string;
  title: string;
  className?: string;
  /** Decorative frames (the live feed) are hidden from assistive tech and the tab order. */
  decorative?: boolean;
  /** Keep the frame idle even near the viewport (a staggered mount: the podium's plinths, #688). */
  hold?: boolean;
  ref?: Ref<HTMLIFrameElement>;
};

/**
 * A reference 3D page in an iframe (design bible 9, 16), mounted only once it comes near the viewport so
 * the page's first paint never waits for three.js; `loading="lazy"` covers browsers that skip the
 * observer. Pair it with `useEmbedBridge` for the postMessage protocol (bible 15).
 */
export function EmbedFrame({
  src,
  title,
  className,
  decorative = false,
  hold = false,
  ref,
}: Props) {
  const inner = useRef<HTMLIFrameElement | null>(null);
  const near = useNearViewport(inner);
  const mounted = near && !hold;

  const setRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <iframe
      ref={setRef}
      title={title}
      src={mounted ? src : undefined}
      loading="lazy"
      className={cn(styles.embed, className)}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      data-embed={mounted ? "mounted" : "idle"}
    />
  );
}
