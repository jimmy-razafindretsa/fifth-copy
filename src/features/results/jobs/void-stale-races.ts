import { MAX_RACE_MS } from "@fifth-copy/protocol";
import type { Job } from "@/worker/job";

/**
 * How long a `Race` row may stay open before the sweep calls it void: the longest race the race server
 * runs (`MAX_RACE_MS`, one hour) plus an hour for the countdown and the results post. A race that ended
 * normally has its end written by `persistRaceResults` within seconds of `ended` (ARCHITECTURE 9.3).
 */
export const VOID_AFTER_MS = MAX_RACE_MS + 60 * 60 * 1000;

/**
 * `race.void` (#613, ADR 0008/0011): a race the race server voided (restart or Redis loss mid-race,
 * #204) persists nothing, so its `Race` row (created at `host:start`) would stay open forever. Every
 * 10 minutes this job ends each row still open `VOID_AFTER_MS` after `startedAt`, with no result, as
 * `endReason` VOID at the run's clock: at most 2 h 10 min after the start. One `updateMany`, idempotent
 * (an ended row never matches again). Should a delayed results post still arrive (outbox retry), it
 * replaces the VOID end with the real one (`persistRaceResults`): VOID never carries results.
 */
export const voidStaleRaces: Job = {
  name: "race.void",
  every: { minutes: 10 },
  run: async ({ db, now, log }) => {
    const { count } = await db.race.updateMany({
      where: {
        endedAt: null,
        startedAt: { lt: new Date(now.getTime() - VOID_AFTER_MS) },
        results: { none: {} },
      },
      data: { endedAt: now, endReason: "VOID" },
    });
    if (count > 0) log.info("races voided", { count });
  },
};
