import type { Prisma } from "@/generated/prisma/client";

/**
 * The races a stats or results consumer counts (#613 C2): ended on ALL_FINISHED or TIMER. A race the
 * race server voided (#204, ADR 0008) ends VOID through the `race.void` job and never matches, nor
 * does a race still open (`endReason` null). Spread it into a `Race` where, or pass it as the
 * `race` relation filter of a `RaceResult` where.
 */
export const COUNTED_RACE = {
  endReason: { in: ["ALL_FINISHED", "TIMER"] },
} satisfies Prisma.RaceWhereInput;
