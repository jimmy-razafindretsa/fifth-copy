/**
 * The stored speed curve of one result (#952, #999 C53, ADR 0027): the engine's `wpmSeries` (clean WPM,
 * ADR 0016, at most `MAX_SERIES_POINTS` points) of the desk's trace on its effective text, as compact
 * `[t, cleanWpm]` pairs (`t` whole ms since GO, WPM to one decimal). Computed once by the filing route
 * from the trace it receives, so no request ever replays another user's keystrokes. Pure.
 */
import { z } from "zod";
import {
  baseLengthOf,
  EMPTY_OVERLAY,
  MAX_SERIES_POINTS,
  normalizeTypeable,
  wpmSeries,
  type Keystroke,
  type TextOverlay,
} from "@fifth-copy/engine";
import { storedEffectiveText } from "./replay-text";
import { storedEngineSettingsSchema } from "./stored-replay";

/** One stored point: `[t, cleanWpm]`. */
export type StoredSeriesPoint = [t: number, wpm: number];

/** `RaceResult.wpmSeries` as read back (untyped JSON from the database is parsed, never trusted). */
export const storedSeriesSchema = z
  .array(z.tuple([z.number().int().nonnegative(), z.number().nonnegative().finite()]))
  .min(1)
  .max(MAX_SERIES_POINTS);

export type FiledSeriesInput = {
  /** `Race.textContent` (raw, as stored). */
  readonly textContent: string;
  /** `Race.settings` (untyped JSON). */
  readonly settings: unknown;
  /** The desk's final overlay as filed; `null` when untouched. */
  readonly overlay: TextOverlay | null;
  readonly keystrokes: readonly Keystroke[];
  /** The scored elapsed time (`durationMs`): the series ends there, so its last point is the clean WPM. */
  readonly durationMs: number;
};

/** The series to store, or `null` (no keystroke, no time, or stored settings the engine cannot use). */
export function filedSeriesOf(input: FiledSeriesInput): StoredSeriesPoint[] | null {
  if (input.keystrokes.length === 0) return null;
  const settings = storedEngineSettingsSchema.safeParse(input.settings);
  if (!settings.success) return null;
  const text = storedEffectiveText({ textContent: input.textContent, overlay: input.overlay });
  const baseLength = baseLengthOf(
    normalizeTypeable(input.textContent),
    input.overlay ?? EMPTY_OVERLAY,
  );
  const points = wpmSeries({
    keystrokes: input.keystrokes,
    text,
    settings: settings.data,
    baseLength,
    endMs: input.durationMs,
  });
  if (points.length === 0) return null;
  return points.map((p) => [Math.round(p.t), Math.round(p.wpm * 10) / 10]);
}
