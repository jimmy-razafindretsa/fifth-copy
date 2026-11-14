"use server";

import { cookies } from "next/headers";
import { env } from "@/env";
import { cookieFlags } from "@/server/auth/cookies";
import {
  LOCKER_SEEN_COOKIE,
  LOCKER_SEEN_MAX_AGE_S,
  NEW_ITEMS,
  serializeSeen,
} from "../clerk/new-items";

/**
 * Opening the locker marks its `NEW` items seen in this browser (#943 C29): the cookie holds the ids of
 * the fixed list, never anything from the request (the action takes no input). Cosmetic: no identity
 * is read or created (ADR 0009).
 */
export async function markLockerSeen(): Promise<void> {
  (await cookies()).set(LOCKER_SEEN_COOKIE, serializeSeen(NEW_ITEMS), {
    ...cookieFlags(env.NODE_ENV),
    maxAge: LOCKER_SEEN_MAX_AGE_S,
  });
}
