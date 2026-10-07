import type { ChainableCommander, Redis } from "ioredis";
import { z } from "zod";
import {
  deskIdentity,
  msSchema,
  phaseSchema,
  raceInfoSchema,
  raceSettingsPatchSchema,
  raceSettingsSchema,
  startRaceRequestSchema,
  type Member,
  type Phase,
  type RaceInfo,
  type RaceSettings,
  type RaceSettingsPatch,
  type StartRaceRequest,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import { nextDesk } from "./desks";
import { desksKey, membersKey, ROOM_TTL_S, roomKey } from "./keys";

export type { Phase };
/** One desk of a race as sent to the web app at start and kept in the room hash (`desks`). */
export type RaceDesk = StartRaceRequest["desks"][number];
export type Room = {
  roomId: string;
  code: string;
  phase: Phase;
  settings: RaceSettings;
  /** Set from `host:start` on (#166); null while the room has never started a race. */
  race: RaceInfo | null;
};
/** What the lifecycle reads, inside `withRoom`, to decide a transition (#166). */
export type RoomState = {
  hostUserId: string;
  phase: Phase;
  settings: RaceSettings;
  race: RaceInfo | null;
  /** Server ms epoch at which the race ends on time; null before the first start. */
  endAt: number | null;
  /** Current members as desks, by desk ascending (humans only until bots are seated, #156). */
  seated: RaceDesk[];
  /** Desks captured at start (ranked at the end even if they left); null before the first start. */
  desks: RaceDesk[] | null;
};

/** `in-progress`: a user who is not already a member while the phase is not `waiting` (#166). */
export type JoinResult =
  | { ok: true; desk: number; members: Member[]; room: Room }
  | { ok: false; reason: "no-room" | "in-progress" };
/** `closed` is true only when this call removed the last member and deleted the room's keys. */
export type LeaveResult = { members: Member[]; closed: boolean };
export type UpdateSettingsResult =
  | { ok: true; settings: RaceSettings }
  | { ok: false; reason: "no-room" | "not-host" | "not-waiting" | "invalid" };

export type RoomRegistry = {
  /** Idempotent: a room keeps the fields (settings included) of its first open. */
  open(input: {
    lobbyId: string;
    code: string;
    hostUserId: string;
    settings: RaceSettings;
  }): Promise<{
    created: boolean;
    room: Room & { phase: "waiting" };
  }>;
  join(lobbyId: string, member: { userId: string; name: string }): Promise<JoinResult>;
  leave(lobbyId: string, userId: string): Promise<LeaveResult>;
  members(lobbyId: string): Promise<Member[] | null>;
  /** The room's settings; null for an unknown room; rejects when the stored field is missing or corrupt. */
  settings(lobbyId: string): Promise<RaceSettings | null>;
  /**
   * The one place a room's settings change (#101): only the room's host (`byUserId` equals the
   * hash's `hostUserId`, never a token role), only while the phase is `waiting`; the patch replaces
   * whole top-level fields and the merged object is validated before it is written. Rejects only on a
   * Redis error or a corrupt room hash.
   */
  updateSettings(
    lobbyId: string,
    byUserId: string,
    patch: RaceSettingsPatch,
  ): Promise<UpdateSettingsResult>;
  /**
   * Runs `fn` in the room's queue, after every pending join/leave/settings call of that room and
   * before the next one. `room`, `startRace` and `setPhase` are called inside it (never the queued
   * methods above: they would wait on themselves).
   */
  withRoom<T>(lobbyId: string, fn: () => Promise<T>): Promise<T>;
  /** The room's lifecycle fields; null for an unknown room; rejects on a corrupt hash. */
  room(lobbyId: string): Promise<RoomState | null>;
  hasMember(lobbyId: string, userId: string): Promise<boolean>;
  /**
   * Phase `countdown` with the race, its clock and its desks, in one MULTI with both TTLs (ADR
   * 0008). The caller checked the phase under `withRoom`.
   */
  startRace(
    lobbyId: string,
    fields: { race: RaceInfo; endAt: number; desks: RaceDesk[] },
  ): Promise<void>;
  /** Writes the phase in one MULTI with both TTLs; the caller checked the room under `withRoom`. */
  setPhase(lobbyId: string, phase: Phase): Promise<void>;
  /** Rooms open on this process (ADR 0008 in-process cache); drives /health and the deploy drain. */
  count(): number;
};

const raceDesksSchema = startRaceRequestSchema.shape.desks;

const seatSchema = z.object({ desk: z.int().min(1), name: z.string().min(1) });
type Seat = z.infer<typeof seatSchema>;

/**
 * Live membership and lifecycle fields of rooms (ADR 0008 "Live room"; ARCHITECTURE 7.1). Redis is the state;
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
   * Sends `tx` with the room TTLs appended, as one MULTI/EXEC: a write never lands without its
   * TTL (ADR 0008, #517); the desks hash (#173) is refreshed with the room. Relative EXPIRE (never from the injected clock: a skewed clock must not
   * expire a live room). ioredis reports per-command errors as [err, value] pairs: rethrow them.
   */
  async function withTtl(lobbyId: string, tx: ChainableCommander) {
    const results = await tx
      .expire(roomKey(lobbyId), ROOM_TTL_S)
      .expire(membersKey(lobbyId), ROOM_TTL_S)
      .expire(desksKey(lobbyId), ROOM_TTL_S)
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
    return {
      code: room.code ?? "",
      hostUserId: room.hostUserId ?? "",
      phase: room.phase,
      settings: room.settings,
      race: room.race,
      endAt: room.endAt,
      desks: room.desks,
    };
  }

  /** Fails loud on a missing or unknown phase, like settings. */
  const parsePhase = (raw: string | undefined): Phase => phaseSchema.parse(raw);
  const parseRace = (raw: string | undefined): RaceInfo | null =>
    raw === undefined ? null : raceInfoSchema.parse(JSON.parse(raw));

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
      .map(([userId, { desk, name }]) => ({
        desk,
        name,
        isHost: userId === hostUserId,
        isBot: false,
        ...deskIdentity(desk),
      }))
      .sort((a, b) => a.desk - b.desk);
  }

  function toDesks(seats: Map<string, Seat>): RaceDesk[] {
    return [...seats.entries()]
      .map(([userId, { desk, name }]) => ({ desk, userId, name, isBot: false }))
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
            // The open response's wire literal (`openRoomResponseSchema`); a re-open of a started
            // room ("Race again", #143) is decided there.
            phase: "waiting",
            settings: room ? parseSettings(lobbyId, room.settings) : settings,
            race: room ? parseRace(room.race) : null,
          },
        };
      }),

    join: (lobbyId, { userId, name }) =>
      serial(lobbyId, async (): Promise<JoinResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { ok: false, reason: "no-room" };
        const settings = parseSettings(lobbyId, room.settings);
        const phase = parsePhase(room.phase);
        const seats = await readSeats(lobbyId);
        // Defence in depth behind the handshake: once started, only existing members come back.
        if (phase !== "waiting" && !seats.has(userId)) return { ok: false, reason: "in-progress" };
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
          room: { roomId: lobbyId, code: room.code, phase, settings, race: parseRace(room.race) },
        };
      }),

    leave: (lobbyId, userId) =>
      serial(lobbyId, async (): Promise<LeaveResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { members: [], closed: false };
        const removed = await redis.hdel(membersKey(lobbyId), userId);
        const seats = await readSeats(lobbyId);
        if (removed === 1 && seats.size === 0) {
          await redis.del(roomKey(lobbyId), membersKey(lobbyId), desksKey(lobbyId));
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

    updateSettings: (lobbyId, byUserId, patch) =>
      serial(lobbyId, async (): Promise<UpdateSettingsResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { ok: false, reason: "no-room" };
        if (byUserId !== room.hostUserId) return { ok: false, reason: "not-host" };
        if (room.phase !== "waiting") return { ok: false, reason: "not-waiting" };
        // Re-checked here for in-process callers (the socket edge already parsed it): no lobbyType,
        // no unknown key. A key present with an undefined value passes .partial(): drop it.
        const parsed = raceSettingsPatchSchema.safeParse(patch);
        if (!parsed.success) return { ok: false, reason: "invalid" };
        const clean = Object.fromEntries(
          Object.entries(parsed.data).filter(([, value]) => value !== undefined),
        );
        const merged = raceSettingsSchema.safeParse({
          ...parseSettings(lobbyId, room.settings),
          ...clean,
        });
        if (!merged.success) return { ok: false, reason: "invalid" };
        await withTtl(
          lobbyId,
          redis.multi().hset(roomKey(lobbyId), "settings", JSON.stringify(merged.data)),
        );
        return { ok: true, settings: merged.data };
      }),

    withRoom: serial,

    room: async (lobbyId) => {
      const room = await readRoom(lobbyId);
      if (!room) return null;
      const seats = await readSeats(lobbyId);
      return {
        hostUserId: room.hostUserId,
        phase: parsePhase(room.phase),
        settings: parseSettings(lobbyId, room.settings),
        race: parseRace(room.race),
        endAt: room.endAt === undefined ? null : msSchema.parse(Number(room.endAt)),
        seated: toDesks(seats),
        desks: room.desks === undefined ? null : raceDesksSchema.parse(JSON.parse(room.desks)),
      };
    },

    hasMember: async (lobbyId, userId) => (await redis.hexists(membersKey(lobbyId), userId)) === 1,

    startRace: async (lobbyId, { race, endAt, desks }) => {
      await withTtl(
        lobbyId,
        redis.multi().hset(roomKey(lobbyId), {
          phase: "countdown",
          raceId: race.raceId,
          t0: String(race.t0),
          endAt: String(endAt),
          race: JSON.stringify(race),
          desks: JSON.stringify(desks),
        }),
      );
    },

    setPhase: async (lobbyId, phase) => {
      await withTtl(lobbyId, redis.multi().hset(roomKey(lobbyId), "phase", phase));
    },

    count: () => openRooms.size,
  };
}
