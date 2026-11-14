"use client";

import { useSyncExternalStore } from "react";
import { hasWebGL2 } from "./webgl";

let probed: boolean | undefined;
const probe = () => (probed ??= hasWebGL2());
const noSubscribe = () => () => {};

/** The WebGL2 probe as a hook: null on the server and while hydrating, the probe's answer after. */
export function useWebGL2(): boolean | null {
  return useSyncExternalStore(noSubscribe, probe, () => null);
}
