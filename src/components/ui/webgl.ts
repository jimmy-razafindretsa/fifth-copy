/** Anything that can hand out a `webgl2` context (a canvas; tests pass a stub). */
export type WebGLCanvas = { getContext(id: "webgl2"): unknown };

/**
 * True when the browser can draw a 3D embed (WebGL2, design bible 9); any failure counts as no. Shared by
 * the podium medal (#300) and the seat scene (#563, `detectWebGL2`): one probe, one answer.
 */
export function hasWebGL2(
  make: () => WebGLCanvas = () => document.createElement("canvas"),
): boolean {
  try {
    return !!make().getContext("webgl2");
  } catch {
    return false;
  }
}
