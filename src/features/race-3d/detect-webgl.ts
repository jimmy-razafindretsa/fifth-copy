import { hasWebGL2 } from "@/components/ui";

/**
 * True when this browser can draw the seat scene (WebGL2, bible 9; #563 C3). The one probe of
 * `@/components/ui` (shared with the podium medal), so a test that stubs `getContext("webgl2")` to
 * `null` turns every 3D slot to its paper fallback at once.
 */
export const detectWebGL2 = (): boolean => hasWebGL2();
