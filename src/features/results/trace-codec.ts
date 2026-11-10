/**
 * The stored keystroke blob (`RaceKeystrokes.data`, ADR 0008): gzip of the JSON `Keystroke[]`. Decoded
 * without trusting the gzip (#189): inflation capped at `count * MAX_KEYSTROKE_JSON_BYTES + 2` bytes (a
 * gzip bomb stops there), then the JSON must be an array of exactly `count` protocol keystrokes. Used
 * by the results ingest (`decodeTrace`) and by the WPM series of the personal card (#865). Pure.
 */
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { Keystroke } from "@fifth-copy/engine";
import { keystrokeSchema } from "@fifth-copy/protocol";

/**
 * The largest JSON of one keystroke plus its separator, in bytes: `{"t":3600000,"key":"Backspace"},`
 * (`t` <= MAX_RACE_MS; any other key is one character, at most 6 bytes once quoted or escaped).
 * Bounds the inflated size of a trace of `count` keystrokes.
 */
export const MAX_KEYSTROKE_JSON_BYTES = 32;

/** `count` keystrokes from their gzip bytes, or null when the bytes are not exactly that. */
export function decodeKeystrokes(data: Uint8Array, count: number): Keystroke[] | null {
  let json: string;
  try {
    json = gunzipSync(data, { maxOutputLength: count * MAX_KEYSTROKE_JSON_BYTES + 2 }).toString(
      "utf8",
    );
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = z.array(keystrokeSchema).length(count).safeParse(value);
  return parsed.success ? parsed.data : null;
}
