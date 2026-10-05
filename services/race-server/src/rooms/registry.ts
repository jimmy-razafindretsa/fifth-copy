import type { Redis } from "ioredis";
import { z } from "zod";
import type { Member } from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import { nextDesk } from "./desks";
import { membersKey, ROOM_TTL_S, roomKey } from "./keys";

export type Phase = "waiting";
export type Room = { roomId: string; code: string; phase: Phase };

export type JoinResult =
  { ok: true; desk: number; members: Member[]; room: Room } | { ok: false; reason: "no-room" };
/** `closed` is true only when this call removed the last member and deleted the room's keys. */
export type LeaveResult = { members: Member[]; closed: boolean };

export type RoomRegistry = {
  open(input: { lobbyId: string; code: string; hostUserId: string }): Promise<{
    created: boolean;
    room: Room;
  }>;
  join(lobbyId: string, member: { userId: string; name: string }): Promise<JoinResult>;
  leave(lobbyId: string, userId: string): Promise<LeaveResult>;
  members(lobbyId: string): Promise<Member[] | null>;
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

  /** Relative EXPIRE (never from the injected clock: a skewed clock must not expire a live room). */
  function touch(lobbyId: string) {
    return redis
      .multi()
      .expire(roomKey(lobbyId), ROOM_TTL_S)
      .expire(membersKey(lobbyId), ROOM_TTL_S)
      .exec();
  }

  async function readRoom(lobbyId: string) {
    const room = await redis.hgetall(roomKey(lobbyId));
    if (!room.openedAt) {
      openRooms.delete(lobbyId);
      return null;
    }
    openRooms.add(lobbyId);
    return { code: room.code ?? "", hostUserId: room.hostUserId ?? "" };
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
    open: ({ lobbyId, code, hostUserId }) =>
      serial(lobbyId, async () => {
        const key = roomKey(lobbyId);
        const created = (await redis.hsetnx(key, "openedAt", String(clock.now()))) === 1;
        if (created) await redis.hset(key, { code, hostUserId, phase: "waiting" });
        await touch(lobbyId);
        const room = await readRoom(lobbyId);
        return { created, room: { roomId: lobbyId, code: room?.code ?? code, phase: "waiting" } };
      }),

    join: (lobbyId, { userId, name }) =>
      serial(lobbyId, async (): Promise<JoinResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { ok: false, reason: "no-room" };
        const seats = await readSeats(lobbyId);
        const desk = seats.get(userId)?.desk ?? nextDesk([...seats.values()].map((s) => s.desk));
        seats.set(userId, { desk, name });
        await redis.hset(membersKey(lobbyId), userId, JSON.stringify({ desk, name }));
        await touch(lobbyId);
        return {
          ok: true,
          desk,
          members: toMembers(seats, room.hostUserId),
          room: { roomId: lobbyId, code: room.code, phase: "waiting" },
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
        await touch(lobbyId);
        return { members: toMembers(seats, room.hostUserId), closed: false };
      }),

    members: async (lobbyId) => {
      const room = await readRoom(lobbyId);
      if (!room) return null;
      return toMembers(await readSeats(lobbyId), room.hostUserId);
    },

    count: () => openRooms.size,
  };
}
