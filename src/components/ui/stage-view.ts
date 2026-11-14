/**
 * What a character stage shows (#932 C4, #946 C6, ADR 0013): the clerk embed, or the viewer's own
 * picture when there is no embed URL, no WebGL2 (or not probed yet), a still specimen, or reduced motion.
 * The one decision, shared by the Personnel file's stage and the Home menu's clerk stage.
 */
export function stageView({
  clerkSrc,
  still,
  webgl,
  reducedMotion = false,
}: {
  clerkSrc: string | null;
  still: boolean;
  webgl: boolean | null;
  reducedMotion?: boolean;
}): "clerk" | "picture" {
  return clerkSrc === null || still || reducedMotion || webgl !== true ? "picture" : "clerk";
}
