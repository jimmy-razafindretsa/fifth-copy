import { z } from "zod";
import { KEY_EVENT_TYPES } from "./compose-keys";

/**
 * The dead-key fixture schema (#1001 C2, the shape of PR #694's, which never reached main). A fixture is
 * a documented event sequence written by hand from a row of `work/log/1001.md` "Documented event
 * sequences": `source: "docs"` and the `ref` URL that documents it; never a recording. Tests only: the
 * client input reads the zod-free types of `compose-keys.ts` (ADR 0025 keeps zod out of client bundles).
 * File name: `fixtures/<os>-<browser>-<layout>-<case>.json`.
 */

export const FIXTURE_OSES = ["windows", "macos", "chromeos"] as const;
export const FIXTURE_BROWSERS = ["chrome", "edge", "firefox", "safari"] as const;
/** The four supported layouts (spec R179). */
export const FIXTURE_LAYOUTS = ["csa", "fr-ca", "azerty", "us"] as const;

/** The cases (#1001 C2) and the characters each commits. */
export const FIXTURE_CASES = {
  "circumflex-e": "ê",
  "c-cedilla": "ç",
  "e-acute": "é",
  "e-grave": "è",
  "u-grave": "ù",
  "oe-ligature": "œ",
  guillemets: "«»",
} as const;
export type FixtureCase = keyof typeof FIXTURE_CASES;
export const FIXTURE_CASE_IDS = Object.keys(FIXTURE_CASES) as [FixtureCase, ...FixtureCase[]];

export const keyEventSchema = z.strictObject({
  type: z.enum(KEY_EVENT_TYPES),
  key: z.string().nullable(),
  code: z.string().nullable(),
  isComposing: z.boolean().nullable(),
  data: z.string().nullable(),
  inputType: z.string().nullable(),
  altKey: z.boolean().optional(),
  ctrlKey: z.boolean().optional(),
  keyCode: z.int().optional(),
});

export const keyEventFixtureSchema = z.strictObject({
  os: z.enum(FIXTURE_OSES),
  browser: z.enum(FIXTURE_BROWSERS),
  layout: z.enum(FIXTURE_LAYOUTS),
  case: z.enum(FIXTURE_CASE_IDS),
  /** Written by hand from the documentation, never recorded on a device. */
  source: z.literal("docs"),
  /** The documentation the sequence follows (a row of the log cites it too). */
  ref: z.url({ protocol: /^https$/ }),
  /** The log row it comes from (`W1` .. `C2`). */
  row: z.string().regex(/^[A-Z]\d+$/),
  events: z.array(keyEventSchema).min(1),
  expected: z.string().min(1),
});
export type KeyEventFixture = z.infer<typeof keyEventFixtureSchema>;
