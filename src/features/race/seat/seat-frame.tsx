"use client";

import { useSyncExternalStore } from "react";
import { useOnScreenKeyboard } from "../client/use-on-screen-keyboard";
import type { SeatFrameProps } from "../components/seat-layout";

const PORTRAIT = "(orientation: portrait)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(PORTRAIT);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * The seat view's root (#251, bible 14.3 tablets): carries `data-osk` (`open` while an on-screen keyboard
 * covers the page, then the layout folds the machine away and keeps the strip and the sheet above it) and
 * `data-orientation` (`landscape` | `portrait`, absent before hydration). Its children stay server
 * rendered; only these two attributes are client state.
 */
export function SeatFrame({ className, children }: SeatFrameProps) {
  const osk = useOnScreenKeyboard();
  const orientation = useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(PORTRAIT).matches ? "portrait" : "landscape"),
    () => undefined,
  );
  return (
    <div
      data-seat
      data-backdrop="paper"
      data-osk={osk}
      data-orientation={orientation}
      className={className}
    >
      {children}
    </div>
  );
}
