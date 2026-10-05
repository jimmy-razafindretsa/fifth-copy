"use server";

import { NotImplementedError } from "@/lib/errors";
import type { JoinByCodeResult } from "../types";

// Resolves a typed room code to an open lobby. Stub: behaviour lands in #103.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function joinByCode(input: { code: string }): Promise<JoinByCodeResult> {
  throw new NotImplementedError("#103");
}
