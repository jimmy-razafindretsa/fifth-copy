"use server";

import { NotImplementedError } from "@/lib/errors";
import type { RaceTokenResult } from "../types";

// Mints the viewer's race token for a lobby (ADR 0009: fetched by an action, never in URLs).
// Stub: behaviour lands in #103.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function mintRaceToken(input: { code: string }): Promise<RaceTokenResult> {
  throw new NotImplementedError("#103");
}
