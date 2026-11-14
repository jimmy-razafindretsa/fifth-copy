import type { Prisma } from "@/generated/prisma/client";
import { COUNTED_RACE } from "@/features/results";
import type { Language } from "../view/profile";

/** The statuses a counted result has (#931): a desk that finished or ran out of time. */
export const COUNTED_STATUSES = ["FINISHED", "TIMED_OUT"] as const;

/**
 * A counted result of `userId` (#931 definitions, ADR 0008): never a bot's, a flagged or a voided
 * race's. The one filter of the stats read paths (the Personnel file, the missions of #943).
 */
export function countedWhere(userId: string, language?: Language): Prisma.RaceResultWhereInput {
  return {
    userId,
    isBot: false,
    suspicious: false,
    status: { in: [...COUNTED_STATUSES] },
    race: language ? { ...COUNTED_RACE, textLanguage: language } : COUNTED_RACE,
  };
}
