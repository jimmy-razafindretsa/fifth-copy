"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * One iframe's half of the postMessage protocol (bible 15). `post` targets the page's own origin (the
 * embeds are served from `/3d/`), and only messages from that origin and that iframe's window reach
 * `onMessage`, after `parse` accepts them (non-null). The listener is a no-op before the frame mounts or
 * without `parse`. `parse` is a plain guard, so the hook pulls no schema library into a first load (#626).
 */
export function useEmbedBridge<T>(
  parse?: (data: unknown) => T | null,
  onMessage?: (message: T) => void,
) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!parse) return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!ref.current?.contentWindow || event.source !== ref.current.contentWindow) return;
      const message = parse(event.data);
      if (message !== null) handler.current?.(message);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [parse]);

  const post = useCallback((message: unknown) => {
    ref.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  return { ref, post };
}
