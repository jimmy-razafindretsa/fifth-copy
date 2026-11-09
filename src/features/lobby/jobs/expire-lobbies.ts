import type { Job } from "@/worker/job";
import { closeLobbies } from "../queries/close-lobbies";
import { ROOM_TTL_MS } from "../room-ttl";

/**
 * How long a WAITING lobby may go without a race before the sweep calls its room gone: twice the
 * room TTL. The room's keys expire `ROOM_TTL_S` after their last write, so past this the room is gone
 * from Redis however busy its waiting room was.
 */
export const EXPIRE_AFTER_MS = 2 * ROOM_TTL_MS;
/** Rows per `updateMany`; a run loops until no stale lobby is left (bounded by `MAX_BATCHES`). */
export const EXPIRE_BATCH = 500;
const MAX_BATCHES = 100;

/**
 * `lobby.expire` (#734, ADR 0011 "lobby and guest expiry"): the race server closes a lobby when its
 * last human leaves (`POST /api/internal/lobbies/:id/close`), but a room whose keys only expired (a
 * crash, a lost close call, an ended room nobody came back to) leaves its row WAITING. Every 15
 * minutes this job closes each WAITING lobby created more than `EXPIRE_AFTER_MS` ago with no `Race`
 * started in that window, at the run's clock, in batches of `EXPIRE_BATCH`. Idempotent: a CLOSED row
 * never matches again and `closeLobbies` only writes WAITING rows.
 */
export const expireLobbies: Job = {
  name: "lobby.expire",
  every: { minutes: 15 },
  run: async ({ db, now, log }) => {
    const cutoff = new Date(now.getTime() - EXPIRE_AFTER_MS);
    let closed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await db.lobby.findMany({
        where: {
          status: "WAITING",
          createdAt: { lt: cutoff },
          races: { none: { startedAt: { gte: cutoff } } },
        },
        orderBy: { createdAt: "asc" },
        take: EXPIRE_BATCH,
        select: { id: true },
      });
      if (rows.length === 0) break;
      closed += await closeLobbies(
        db,
        rows.map((row) => row.id),
        now,
      );
      if (rows.length < EXPIRE_BATCH) break;
    }
    if (closed > 0) log.info("lobbies expired", { count: closed });
  },
};
