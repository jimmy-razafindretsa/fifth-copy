import "server-only";
import { cookies } from "next/headers";
import { LOCKER_SEEN_COOKIE, type NewItemId, parseSeen, unseenNewItems } from "../clerk/new-items";

/** The `NEW` items this browser saw in the locker (#943 C29): the cookie's ids, a tampered value as none. */
export async function getLockerSeen(): Promise<NewItemId[]> {
  return parseSeen((await cookies()).get(LOCKER_SEEN_COOKIE)?.value);
}

/** The `NEW` items this browser has not seen yet (the MY CLERK tag's count). */
export async function getLockerUnseen(): Promise<NewItemId[]> {
  return unseenNewItems(await getLockerSeen());
}
