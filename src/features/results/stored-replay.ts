/**
 * What a replay of one stored trace needs (#314, ADR 0007, 0008, 0016): the decoded keystrokes, the
 * desk's effective text (`storedEffectiveText`: base plus its overlay) and the engine settings of the
 * stored `Race.settings`. Shared by the personal card (#865, #867) and the per-key rollup job of the
 * stats feature (#314). Pure: callers pass the stored values.
 */
import { z } from "zod";
import type { EngineSettings, Keystroke } from "@fifth-copy/engine";
import { textOverlaySchema } from "@fifth-copy/protocol";
import { storedEffectiveText } from "./replay-text";
import { decodeKeystrokes } from "./trace-codec";

/** The engine's subset of the stored `Race.settings` (the wire's `engineSettingsOf`). */
export const storedEngineSettingsSchema = z.object({
  errorMode: z.enum(["continue", "block"]),
  backspace: z.boolean(),
});

export type StoredTrace = {
  /** `Race.textContent`. */
  readonly textContent: string;
  /** `Race.settings`: untyped JSON. */
  readonly settings: unknown;
  /** `RaceResult.overlay`: untyped JSON, `null` without a text-changing bonus. */
  readonly overlay: unknown;
  /** `RaceKeystrokes.data` and `.count`. */
  readonly data: Uint8Array;
  readonly count: number;
};

export type StoredReplay = {
  readonly keystrokes: Keystroke[];
  readonly text: string;
  readonly settings: EngineSettings;
};

/** The replay input of a stored trace, or null when a stored value is not what it must be. */
export function storedReplay(trace: StoredTrace): StoredReplay | null {
  const settings = storedEngineSettingsSchema.safeParse(trace.settings);
  const overlay = textOverlaySchema.nullable().safeParse(trace.overlay ?? null);
  if (!settings.success || !overlay.success) return null;
  const keystrokes = decodeKeystrokes(trace.data, trace.count);
  if (!keystrokes) return null;
  const text = storedEffectiveText({ textContent: trace.textContent, overlay: overlay.data });
  return { keystrokes, text, settings: settings.data };
}
