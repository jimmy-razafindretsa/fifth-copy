import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";
import { MERGED_COOKIE, MERGED_COOKIE_MAX_AGE, mergedRaces } from "./flash-cookie";
import type { MergeCounts } from "./merge-guest";

/**
 * Leaves the merge flash for the next render (#57): call it from the Server Action or Route Handler that
 * just ran `mergeGuestInto` (sign-up #39, sign-in #40, OAuth #50), with its counts, before redirecting.
 * Readable by scripts on purpose: the stamp clears it in the browser once shown (./flash-cookie.ts).
 */
export async function flashMerge(counts: MergeCounts): Promise<void> {
  (await cookies()).set(MERGED_COOKIE, String(mergedRaces(counts)), {
    path: "/",
    maxAge: MERGED_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
    secure: env.NODE_ENV === "production",
  });
}
