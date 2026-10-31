import { z } from "zod";
import {
  FIXTURE_BROWSERS,
  FIXTURE_CASE_IDS,
  FIXTURE_LAYOUTS,
  FIXTURE_OSES,
  KEY_EVENT_TYPES,
  type FixtureCase,
  type KeyEventFixture,
} from "./fixture-cases";

/**
 * The dead-key fixture schema (#566 C2). Tests and server code only: client code uses the zod-free
 * shape in `fixture-cases.ts` (#626 keeps zod out of client bundles).
 */
export const recordedKeyEventSchema = z.strictObject({
  type: z.enum(KEY_EVENT_TYPES),
  key: z.string().nullable(),
  code: z.string().nullable(),
  isComposing: z.boolean().nullable(),
  data: z.string().nullable(),
  inputType: z.string().nullable(),
});

export const keyEventFixtureSchema = z.strictObject({
  os: z.enum(FIXTURE_OSES),
  browser: z.enum(FIXTURE_BROWSERS),
  layout: z.enum(FIXTURE_LAYOUTS),
  case: z.enum(FIXTURE_CASE_IDS as [FixtureCase, ...FixtureCase[]]),
  events: z.array(recordedKeyEventSchema).min(1),
  expected: z.string().min(1),
}) satisfies z.ZodType<KeyEventFixture>;
