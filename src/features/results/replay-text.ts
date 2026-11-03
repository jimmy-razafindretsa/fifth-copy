/**
 * The text a stored result's trace was typed on (#623, ADR 0007, ADR 0016): the race's base text
 * (`Race.textContent`, stored raw) normalised as the race server normalised it, plus the desk's
 * stored overlay (`RaceResult.overlay`). Any replay of a stored trace (`analyseTrace`, the worker's
 * re-analysis, #302's WPM series) runs on this, never on the base text alone, which would flag or
 * mis-score an innocent overlaid desk. Pure: no database access; callers pass the two stored values.
 */
import { EMPTY_OVERLAY, effectiveText, normalizeTypeable } from "@fifth-copy/engine";
import { textOverlaySchema } from "@fifth-copy/protocol";

const storedOverlaySchema = textOverlaySchema.nullable();

export type StoredReplayText = {
  /** `Race.textContent`: the base text as stored, before normalisation. */
  readonly textContent: string;
  /** `RaceResult.overlay`: untyped JSON from the database; `null` when no text-changing bonus hit the desk. */
  readonly overlay: unknown;
};

/**
 * `effectiveText(normalizeTypeable(textContent), overlay)`, the normalised base text when `overlay`
 * is `null`. Throws when the stored overlay is not a protocol `TextOverlay`: a corrupt row must
 * surface, never silently replay on the base text.
 */
export function storedEffectiveText({ textContent, overlay }: StoredReplayText): string {
  const parsed = storedOverlaySchema.parse(overlay);
  return effectiveText(normalizeTypeable(textContent), parsed ?? EMPTY_OVERLAY);
}
