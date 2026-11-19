"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { isPhoneViewport } from "@/lib/phone";

const noop = () => () => {};

/**
 * Whether this page runs on a phone viewport (480px and under, #999 C9), read once on the client:
 * `null` on the server and in the hydration pass (no window to ask), then the viewport's answer, kept
 * for the component's life so a window resized across 480px later keeps its role.
 */
export function usePhoneAtMount(): boolean | null {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  // one latch per mounted component: the first client read decides
  const [read] = useState(() => {
    let phone: boolean | null = null;
    return () => (phone ??= isPhoneViewport());
  });
  return client ? read() : null;
}

/**
 * Which screen a race page shows (#999 C9, bible 14.3 "Phone spectator", 18): the server renders `wide`
 * (the seat view, whose phone-width render is only the `PHONES WATCH…` notice, or the projector view);
 * on the client a phone viewport (480px and under) swaps it for `phone`, the spectator screen, so a
 * phone never keeps a desk's page. Decided once (`usePhoneAtMount`). The seat's own live leaf checks
 * the same query before connecting and before mounting the race input, so a phone never mints a desk's
 * token, opens its socket or mounts the typing surface on the way.
 */
export function PhoneSwitch({ wide, phone }: { wide: ReactNode; phone: ReactNode }) {
  return <>{usePhoneAtMount() ? phone : wide}</>;
}
