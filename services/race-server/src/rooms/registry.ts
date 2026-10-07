import type { ChainableCommander, Redis } from "ioredis";
import { z } from "zod";
import { raceSettingsSchema, type Member, type RaceSettings } from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import { nextDesk } from "./desks";
import { membersKey, ROOM_TTL_S, roomKey } from "./keys";

export type Phase = "waiting";
export type Room = { roomId: string; code: string; phase: Phase; settings: RaceSettings };

export type JoinResult =
  { ok: true; desk: number; members: Member[]; room: Room } | { ok: false; reason: "no-room" };
/** `closed` is true only when this call removed the last member and deleted the room's keys. */
export type LeaveResult = { members: Member[]; closed: boolean };

export type RoomRegistry = {
  /** Idempotent: a room keeps the fields (settings included) of its first open. */
  open(input: {
    lobbyId: string;
    code: string;
    hostUserId: string;
    settings: RaceSettings;
  }): Promise<{
    created: boolean;
    room: Room;
  }>;
  join(lobbyId: string, member: { userId: string; name: string }): Promise<JoinResult>;
  leave(lobbyId: string, userId: string): Promise<LeaveResult>;
  members(lobbyId: string): Promise<Member[] | null>;
  /** The room's settings; null for an unknown room; rejects when the stored field is missing or corrupt. */
  settings(lobbyId: string): Promise<RaceSettings | null>;
  /** Rooms open on this process (ADR 0008 in-process cache); drives /health and the deploy drain. */
  count(): number;
};

const seatSchema = z.object({ desk: z.int().min(1), name: z.string().min(1) });
type Seat = z.infer<typeof seatSchema>;

/**
 * Live membership of waiting rooms (ADR 0008 "Live room"; ARCHITECTURE 7.1). Redis is the state;
 * this process keeps only the set of open room ids for count(). join/leave read-modify-write the
 * members hash, so calls on one room are serialised in-process (one race server per deployment).
 */
export function createRoomRegistry({ redis, clock }: { redis: Redis; clock: Clock }): RoomRegistry {
  const openRooms = new Set<string>();
  const chains = new Map<string, Promise<unknown>>();

  function serial<T>(lobbyId: string, fn: () => Promise<T>): Promise<T> {
    const next = (chains.get(lobbyId) ?? Promise.resolve()).then(fn);
    const tail = next.catch(() => undefined);
    chains.set(lobbyId, tail);
    void tail.then(() => {
      if (chains.get(lobbyId) === tail) chains.delete(lobbyId);
    });
    return next;
  }

  /**
   * Sends `tx` with both room TTLs appended, as one MULTI/EXEC: a write never lands without its
   * TTL (ADR 0008, #517). Relative EXPIRE (never from the injected clock: a skewed clock must not
   * expire a live room). ioredis reports per-command errors as [err, value] pairs: rethrow them.
   */
  async function withTtl(lobbyId: string, tx: ChainableCommander) {
    const results = await tx
      .expire(roomKey(lobbyId), ROOM_TTL_S)
      .expire(membersKey(lobbyId), ROOM_TTL_S)
      .exec();
    if (!results) throw new Error(`room ${lobbyId}: transaction aborted`);
    for (const [err] of results) if (err) throw err;
    return results.map(([, value]) => value);
  }

  async function readRoom(lobbyId: string) {
    const room = await redis.hgetall(roomKey(lobbyId));
    if (!room.openedAt) {
      openRooms.delete(lobbyId);
      return null;
    }
    openRooms.add(lobbyId);
    return { code: room.code ?? "", hostUserId: room.hostUserId ?? "", settings: room.settings };
  }

  /** Fails loud: a room without valid settings is a bug, never a silent default. */
  function parseSettings(lobbyId: string, raw: string | undefined): RaceSettings {
    if (raw === undefined) throw new Error(`room ${lobbyId}: settings missing`);
    return raceSettingsSchema.parse(JSON.parse(raw));
  }

  async function readSeats(lobbyId: string) {
    const raw = await redis.hgetall(membersKey(lobbyId));
    return new Map(
      Object.entries(raw).map(([userId, json]): [string, Seat] => [
        userId,
        seatSchema.parse(JSON.parse(json)),
      ]),
    );
  }

  function toMembers(seats: Map<string, Seat>, hostUserId: string): Member[] {
    return [...seats.entries()]
      .map(([userId, { desk, name }]) => ({ desk, name, isHost: userId === hostUserId }))
      .sort((a, b) => a.desk - b.desk);
  }

  return {
    open: ({ lobbyId, code, hostUserId, settings }) =>
      serial(lobbyId, async () => {
        const key = roomKey(lobbyId);
        // HSETNX per field: only a new room gets its fields, a half-written one is completed.
        const [openedAt] = await withTtl(
          lobbyId,
          redis
            .multi()
            .hsetnx(key, "openedAt", String(clock.now()))
            .hsetnx(key, "code", code)
            .hsetnx(key, "hostUserId", hostUserId)
            .hsetnx(key, "phase", "waiting")
            .hsetnx(key, "settings", JSON.stringify(settings)),
        );
        const created = openedAt === 1;
        const room = await readRoom(lobbyId);
        return {
          created,
          room: {
            roomId: lobbyId,
            code: room?.code ?? code,
            phase: "waiting",
            settings: room ? parseSettings(lobbyId, room.settings) : settings,
          },
        };
      }),

    join: (lobbyId, { userId, name }) =>
      serial(lobbyId, async (): Promise<JoinResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { ok: false, reason: "no-room" };
        const settings = parseSettings(lobbyId, room.settings);
        const seats = await readSeats(lobbyId);
        const desk = seats.get(userId)?.desk ?? nextDesk([...seats.values()].map((s) => s.desk));
        seats.set(userId, { desk, name });
        await withTtl(
          lobbyId,
          redis.multi().hset(membersKey(lobbyId), userId, JSON.stringify({ desk, name })),
        );
        return {
          ok: true,
          desk,
          members: toMembers(seats, room.hostUserId),
          room: { roomId: lobbyId, code: room.code, phase: "waiting", settings },
        };
      }),

    leave: (lobbyId, userId) =>
      serial(lobbyId, async (): Promise<LeaveResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { members: [], closed: false };
        const removed = await redis.hdel(membersKey(lobbyId), userId);
        const seats = await readSeats(lobbyId);
        if (removed === 1 && seats.size === 0) {
          await redis.del(roomKey(lobbyId), membersKey(lobbyId));
          openRooms.delete(lobbyId);
          return { members: [], closed: true };
        }
        await withTtl(lobbyId, redis.multi());
        return { members: toMembers(seats, room.hostUserId), closed: false };
      }),

    members: async (lobbyId) => {
      const room = await readRoom(lobbyId);
      if (!room) return null;
      return toMembers(await readSeats(lobbyId), room.hostUserId);
    },

    settings: async (lobbyId) => {
      const room = await readRoom(lobbyId);
      return room ? parseSettings(lobbyId, room.settings) : null;
    },

    count: () => openRooms.size,
  };
}
