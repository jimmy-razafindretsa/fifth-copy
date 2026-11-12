/**
 * The race's named sounds (#243): the files under `public/sounds/` (`<name>.ogg`, `<name>.mp3` fallback),
 * listed with their licences in `public/sounds/LICENSES.md`. Extension point: #272 registers `bulb` on the
 * engine (`engine.register`) with the same `play(name)`.
 */
export const SOUND_NAMES = ["clack", "jam", "stamp"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** Where a sound's file is served, in the format the browser decodes (`ogg` first, `mp3` for Safari). */
export function soundUrl(name: string, format: "ogg" | "mp3"): string {
  return `/sounds/${name}.${format}`;
}
