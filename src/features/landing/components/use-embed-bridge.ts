"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ZodType } from "zod";

/**
 * One iframe's half of the postMessage protocol (bible 15). `post` targets the page's own origin (the
 * embeds are served from `/3d/`), and only messages from that origin and that iframe's window reach
 * `onMessage`, after passing `schema`. The listener is a no-op before the frame mounts or without a schema.
 */
export function useEmbedBridge<T>(schema?: ZodType<T>, onMessage?: (message: T) => void) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!schema) return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!ref.current?.contentWindow || event.source !== ref.current.contentWindow) return;
      const parsed = schema.safeParse(event.data);
      if (parsed.success) handler.current?.(parsed.data);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [schema]);

  const post = useCallback((message: unknown) => {
    ref.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  return { ref, post };
}
