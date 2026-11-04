import "server-only";
import { cookies } from "next/headers";
import { env } from "@/env";
import { GUEST_COOKIE, verifyGuestCookie } from "@/server/auth";
import { logger } from "@/server/logger";
import { flashMerge } from "./flash";
import { mergeGuestInto } from "./merge-guest";

/**
 * The upgrade step of sign-up and sign-in (ADR 0009, #36 C3 and C7): when the request carries a validly
 * signed `fc_guest` cookie, that guest's history moves into `accountId` (`mergeGuestInto`, #56), the
 * merge stamp is flashed (`flashMerge`, #57) and the cookie is cleared. A cookie that fails its signature
 * is cleared without a merge. A merge that throws keeps the cookie (the guest's rows are still there, so
 * the next sign-in retries) and never fails the sign-in: the account is already signed in. Only the
 * error's name is logged.
 */
export async function mergeGuestCookieInto(accountId: string): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(GUEST_COOKIE)?.value;
  if (raw === undefined) return;
  const guestId = verifyGuestCookie(raw, env.AUTH_SECRET);
  if (guestId === null || guestId === accountId) {
    jar.delete(GUEST_COOKIE);
    return;
  }
  try {
    const counts = await mergeGuestInto(guestId, accountId);
    await flashMerge(counts);
    jar.delete(GUEST_COOKIE);
  } catch (error) {
    logger.warn("guest merge on sign-in failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
