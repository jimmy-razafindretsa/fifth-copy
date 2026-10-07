"use client";

import { type RefObject, useEffect, useState } from "react";

/** How close to the viewport a lazy embed or video starts loading (bible 9: first paint never waits). */
export const NEAR_VIEWPORT = "320px";

/**
 * True once the element has come within `margin` of the viewport (latched: it never goes back to false).
 * Browsers without IntersectionObserver get true at once.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = NEAR_VIEWPORT): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setNear(true));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** True while any part of the element is on screen (no margin); false before the first callback. */
export function useInViewport(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setVisible(last.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}
