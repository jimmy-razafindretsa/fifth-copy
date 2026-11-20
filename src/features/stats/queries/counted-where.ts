import type { Prisma } from "@/generated/prisma/client";
import { COUNTED_RACE } from "@/features/results/server";
import { COUNTED_STATUSES } from "../counted";
import type { Language } from "../view/profile";

export { COUNTED_STATUSES };

/**
 * A counted result of anyone (#966, ADR 0008): never a bot's, a flagged or a voided race's. The rule of
 * `countedWhere` without the user, for population reads (the typist census, ADR 0023).
 */
export function countedPopulationWhere(language?: Language): Prisma.RaceResultWhereInput {
  return {
    isBot: false,
    suspicious: false,
    status: { in: [...COUNTED_STATUSES] },
    race: language ? { ...COUNTED_RACE, textLanguage: language } : COUNTED_RACE,
  };
}

/**
 * A counted result of `userId` (#931 definitions, ADR 0008): never a bot's, a flagged or a voided
 * race's. The one filter of the stats read paths (the Personnel file, the missions of #943).
 */
export function countedWhere(userId: string, language?: Language): Prisma.RaceResultWhereInput {
  return { userId, ...countedPopulationWhere(language) };
}
