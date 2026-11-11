import "server-only";
import { db } from "@/server/db";

/** How long after a race its typists still count as lobby mates (ADR 0022, #880). */
export const RACED_TOGETHER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether `a` and `b` both have a `RaceResult` (a person's: `userId` set, so never a bot) on one
 * `Race` whose `endedAt` is less than 24 h before `now` (ms epoch). A race that never ended does not
 * count. One indexed read (`RaceResult.userId`); throws when Postgres does (the caller fails closed).
 */
export async function racedTogether(a: string, b: string, now: number): Promise<boolean> {
  const hit = await db.raceResult.findFirst({
    where: {
      userId: a,
      race: {
        endedAt: { gt: new Date(now - RACED_TOGETHER_WINDOW_MS) },
        results: { some: { userId: b } },
      },
    },
    select: { id: true },
  });
  return hit !== null;
}
