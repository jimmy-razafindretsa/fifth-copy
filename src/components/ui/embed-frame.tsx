"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { cn } from "@/lib/cn";
import styles from "./embed-frame.module.css";

type Props = {
  src: string;
  title: string;
  className?: string;
  /** Decorative frames (the live feed) are hidden from assistive tech and the tab order. */
  decorative?: boolean;
  ref?: Ref<HTMLIFrameElement>;
};

const NEAR_VIEWPORT = "320px";

/**
 * A reference 3D page in an iframe (design bible 9, 16), mounted only once it comes near the viewport so
 * the page's first paint never waits for three.js; `loading="lazy"` covers browsers that skip the
 * observer. Pair it with `useEmbedBridge` for the postMessage protocol (bible 15).
 */
export function EmbedFrame({ src, title, className, decorative = false, ref }: Props) {
  const [near, setNear] = useState(false);
  const inner = useRef<HTMLIFrameElement | null>(null);

  const setRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      inner.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    const node = inner.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // no observer support: mount at once by writing the attribute the render would set
      node.src = src;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [src]);

  return (
    <iframe
      ref={setRef}
      title={title}
      src={near ? src : undefined}
      loading="lazy"
      className={cn(styles.embed, className)}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      data-embed={near ? "mounted" : "idle"}
    />
  );
}
