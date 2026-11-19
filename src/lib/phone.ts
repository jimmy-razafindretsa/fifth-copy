/**
 * The bible's phone rule (18; 14.3 "Phone spectator", #999 C9): a viewport 480px wide and under watches
 * and never takes a desk. One constant for every feature that decides it (the seat view, the lobby, the
 * landing's watch entry): pure, no browser access at import.
 */
export const PHONE_MAX_WIDTH_PX = 480;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;

/**
 * Whether this browser's viewport is a phone's, read once (the role is chosen at mount: a window resized
 * across 480px later keeps it). `false` outside a browser.
 */
export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}
