import type { ChainableCommander, Redis } from "ioredis";
import { z } from "zod";
import {
  botLevelSchema,
  deskIdentity,
  endReasonSchema,
  MAX_BOTS,
  msSchema,
  phaseSchema,
  raceInfoSchema,
  raceSettingsPatchSchema,
  raceSettingsSchema,
  startRaceRequestSchema,
  type BotLevel,
  type EndReason,
  type Member,
  type Phase,
  type RaceInfo,
  type RaceLanguage,
  type RaceSettings,
  type RaceSettingsPatch,
  type StartRaceRequest,
} from "@fifth-copy/protocol";
import type { Clock } from "../clock";
import { botName, botUserId, isBotUserId, planBotSeats } from "./bots";
import { nextDesk } from "./desks";
import {
  desksKey,
  ENDED_GRACE_TTL_S,
  membersKey,
  resumeIndexKey,
  resumeKey,
  ROOM_TTL_S,
  roomKey,
  ROOMS_KEY,
  traceKey,
  VOID_TTL_S,
} from "./keys";

/** Period of `reconcile` (#204): fixed, it must not scale with `RACE_FAST_CLOCK`. */
export const RECONCILE_MS = 60_000;

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
  /** The room's code, as opened (the spectator's `welcome`, #187). */
  code: string;
  hostUserId: string;
  phase: Phase;
  settings: RaceSettings;
  race: RaceInfo | null;
  /** Server ms epoch at which the race ends on time; null before the first start. */
  endAt: number | null;
  /** Current members as desks, by desk ascending, bots included (`userId: null`, #156). */
  seated: RaceDesk[];
  /** Desks captured at start (ranked at the end even if they left); null before the first start. */
  desks: RaceDesk[] | null;
  /** The last race's id; kept by a void (#204), so `ended { void }` can name it. */
  raceId: string | null;
  /** Set only on a room voided by a restart (#204): `void`. */
  endReason: EndReason | null;
  /** The pending automatic start of a public room (#814), server ms epoch; null when none. */
  autoStartAt: number | null;
};

/** What `rehydrate` did, by lobby id (#204). */
export type Rehydrated = { kept: string[]; voided: string[]; gone: string[]; foreign: string[] };

/** A race `reconcile` voided because its owner process is gone (#704). */
export type Voided = { lobbyId: string; raceId: string };

/**
 * `in-progress`: a user who is not already a member while a race is on (`countdown`, `running`; #166).
 * `bot-id`: a user id in the bots' reserved `bot:` space (#156; web user ids are cuids).
 * `room-full`: a user who is not a member while `ROOM_SEATS` desks (typists and bots) are seated (#732).
 */
export type JoinResult =
  | { ok: true; desk: number; members: Member[]; room: Room }
  | { ok: false; reason: "no-room" | "in-progress" | "bot-id" | "room-full" };
/**
 * `closed` is true only when this call removed the last human member and deleted the room's keys
 * (bots seated with no human left go with the room, ARCHITECTURE 7.1 "last human leaves").
 * `kept` (#143): the last human left a room in phase `ended`; its keys stay for
 * `ENDED_GRACE_TTL_S` so a member can come back for "Race again". Either way nothing of the room
 * is left in this process's live race state.
 */
export type LeaveResult = { members: Member[]; closed: boolean; kept: boolean };

/**
 * Desks in a room (spec 5.2, owner decision 2026-11-03: 30 desks, humans and bots together; one is
 * the host's, so `MAX_BOTS` is the rest).
 */
export const ROOM_SEATS = MAX_BOTS + 1;

/**
 * Whether a user who is not yet a member finds every desk taken (#732): `ROOM_SEATS` desks are
 * seated, typists and bots alike. A member (a second tab) is never refused by it.
 */
export function seatsFull(members: readonly unknown[], isMember: boolean): boolean {
  return !isMember && members.length >= ROOM_SEATS;
}

/**
 * Whether a bots list would seat more desks than the room has (#732): the typists seated plus the
 * bots. A list that does not add bots is never refused, so a host can always remove one.
 */
function botsOverflow(seats: Map<string, Seat>, bots: readonly unknown[]): boolean {
  const seated = [...seats.values()];
  const typists = seated.filter((seat) => !seat.isBot).length;
  const current = seated.length - typists;
  return bots.length > current && typists + bots.length > ROOM_SEATS;
}

/**
 * Who may take a seat (#166, #143, #732), behind the verified race token: anyone while the room is
 * `waiting` or `ended` (spec 5.1: a late joiner is seated once the race is over); while a race is
 * on (`countdown`, `running`) only a current member (a second tab, a resume). Never a stranger
 * mid-race: a late joiner holds a spectator socket until `ended`. The last race's racers keep
 * their desk preference in `join`.
 */
export function mayRejoin(room: Pick<RoomState, "phase">, isMember: boolean): boolean {
  return room.phase === "waiting" || room.phase === "ended" || isMember;
}
/** `members` is set when the patch carried `bots`: the room was re-seated (#156). */
export type UpdateSettingsResult =
  | { ok: true; settings: RaceSettings; members?: Member[] }
  | { ok: false; reason: "no-room" | "not-host" | "not-waiting" | "invalid" };
export type SetBotsResult =
  { ok: true; members: Member[] } | { ok: false; reason: "no-room" | "not-waiting" | "invalid" };

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
  /**
   * Seats one bot member per entry (#156): `settings.bots` and the bot records of the members hash
   * are written together, in one MULTI with the TTLs. Bots keep their desks lowest first, new ones
   * take the lowest free desks (never desk 1), extra ones leave highest desk first. Only while the
   * phase is `waiting`. `open` and a `bots` patch of `updateSettings` seat through the same rule.
   */
  setBots(lobbyId: string, bots: { level: BotLevel }[]): Promise<SetBotsResult>;
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
   * The level of each bot desk of the members hash (#366: the drivers at GO), by desk. One HGETALL,
   * not queued (the lifecycle reads it inside `withRoom`); empty for an unknown room.
   */
  botLevels(lobbyId: string): Promise<Map<number, BotLevel>>;
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
  /**
   * Writes (a ms epoch) or deletes (`null`) the room's pending automatic start (#814), in one MULTI
   * with the room's TTLs. Not queued: the lifecycle calls it inside `withRoom`.
   */
  setAutoStart(lobbyId: string, at: number | null): Promise<void>;
  /**
   * Voids the room's race (#204, ADR 0008 "Restart behaviour"), not queued (call it inside
   * `withRoom`). A room whose hash exists turns `ended` with `endReason: void` and `endedAt`, loses
   * its race fields, keeps its members and `raceId`, and both hashes get `VOID_TTL_S`; a room whose
   * hash is gone (Redis loss) is `lost`: its leftover keys are deleted and it leaves `count()`. Both
   * delete the desks mirror, the trace lists (of the stored desks and of `desks`) and the resume
   * keys: none is ever read back. One MULTI.
   */
  voidRoom(lobbyId: string, desks?: readonly number[]): Promise<{ lost: boolean }>;
  /**
   * Boot (#204): for every id of the `rooms` index whose hash exists, `waiting`/`ended` rooms are
   * counted as they are, `countdown`/`running` ones are voided; ids whose hash is gone leave the index.
   * A live race whose `owner` is another process still holding its lease (#704: the deployment being
   * drained) is left alone and not counted (`foreign`) until `reconcile` finds that owner gone.
   * Reads only `room:<id>` (and the members through later calls), never the desks mirror.
   */
  rehydrate(): Promise<Rehydrated>;
  /**
   * Drops from `count()` and the index every open room whose hash no longer exists (#204). A live
   * race whose `owner` is another process whose lease is gone (#704: killed, or closed at its drain
   * cap) is voided, whether this process found it at boot (`foreign`) or counted it already; a
   * foreign room with no live race is adopted. Resolves with the voided races, so the caller tells
   * the sockets this process holds for them.
   */
  reconcile(): Promise<Voided[]>;
  /** Rooms open on this process (ADR 0008 in-process cache); drives /health and the deploy drain. */
  count(): number;
  /** The ids `count()` counts (#704: the drain walks them). */
  ids(): string[];
  /** In-process only (#704 drain): this process stops counting the room; Redis keeps it. */
  release(lobbyId: string): void;
};

const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: "info", msg, ...fields }));

/** What a restart does to a room, by its stored phase (#204; #143's "Race again" reuses it). */
const RECOVERY: Record<Phase, "keep" | "void"> = {
  waiting: "keep",
  ended: "keep",
  countdown: "void",
  running: "void",
};

async function execAll(lobbyId: string, tx: ChainableCommander) {
  const results = await tx.exec();
  if (!results) throw new Error(`room ${lobbyId}: transaction aborted`);
  for (const [err] of results) if (err) throw err;
  return results.map(([, value]) => value);
}

const raceDesksSchema = startRaceRequestSchema.shape.desks;

/** A members-hash record: humans `{ desk, name }`, bots also `isBot: true` and their level (#156). */
const seatSchema = z.object({
  desk: z.int().min(1),
  name: z.string().min(1),
  isBot: z.literal(true).optional(),
  level: botLevelSchema.optional(),
});
type Seat = z.infer<typeof seatSchema>;
const botsSchema = raceSettingsSchema.shape.bots;

/**
 * Live membership and lifecycle fields of rooms (ADR 0008 "Live room"; ARCHITECTURE 7.1). Redis is the state;
 * this process keeps only the set of open room ids for count(). join/leave read-modify-write the
 * members hash, so calls on one room are serialised in-process (one race server per deployment).
 */
export function createRoomRegistry({
  redis,
  clock,
  owner,
}: {
  redis: Redis;
  clock: Clock;
  /** This process's lease (#704): stamped on each race start, checked on boot for others' races. */
  owner?: { id: string; alive(id: string): Promise<boolean> };
}): RoomRegistry {
  const openRooms = new Set<string>();
  /** Live races of another process still alive at boot (#704); not counted, not voided. */
  const foreign = new Set<string>();
  const chains = new Map<string, Promise<unknown>>();

  /** Whether `id` names another process that still holds its lease (#704). */
  async function ownedElsewhere(id: string | undefined) {
    return !!owner && !!id && id !== owner.id && (await owner.alive(id));
  }
  /** Whether `id` names another process whose lease is gone (#704). */
  async function ownerGone(id: string | undefined) {
    return !!owner && !!id && id !== owner.id && !(await owner.alive(id));
  }

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
    return execAll(
      lobbyId,
      tx
        .expire(roomKey(lobbyId), ROOM_TTL_S)
        .expire(membersKey(lobbyId), ROOM_TTL_S)
        .expire(desksKey(lobbyId), ROOM_TTL_S)
        // The index outlives each room it lists (#204).
        .expire(ROOMS_KEY, ROOM_TTL_S),
    );
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
      raceId: room.raceId,
      endReason: room.endReason,
      autoStartAt: room.autoStartAt,
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
      .map(([userId, { desk, name, isBot = false }]) => ({
        desk,
        name,
        isHost: !isBot && userId === hostUserId,
        isBot,
        ...deskIdentity(desk),
      }))
      .sort((a, b) => a.desk - b.desk);
  }

  /** Bots have no user on the wire (`startRaceRequest.desks[].userId`). */
  function toDesks(seats: Map<string, Seat>): RaceDesk[] {
    return [...seats.entries()]
      .map(([userId, { desk, name, isBot = false }]) => ({
        desk,
        userId: isBot ? null : userId,
        name,
        isBot,
      }))
      .sort((a, b) => a.desk - b.desk);
  }

  /**
   * Appends to `tx` the members-hash writes that seat `bots` (one per entry), and applies them to
   * `seats`. Not queued: callers run it inside their own `serial` step (never nest `serial`).
   */
  function seatBots(
    tx: ChainableCommander,
    lobbyId: string,
    seats: Map<string, Seat>,
    bots: readonly { level: BotLevel }[],
    language: RaceLanguage,
  ) {
    const botDesks = [...seats.values()].filter((s) => s.isBot).map((s) => s.desk);
    const taken = [...seats.values()].map((s) => s.desk);
    const plan = planBotSeats(
      botDesks,
      taken,
      bots.map((b) => b.level),
    );
    if (plan.remove.length) {
      tx.hdel(membersKey(lobbyId), ...plan.remove.map(botUserId));
      for (const desk of plan.remove) seats.delete(botUserId(desk));
    }
    for (const { desk, level } of plan.seats) {
      const seat: Seat = { desk, name: botName(desk, language), isBot: true, level };
      seats.set(botUserId(desk), seat);
      tx.hset(membersKey(lobbyId), botUserId(desk), JSON.stringify(seat));
    }
    return tx;
  }

  /** The trace list keys of the desks stored in the room hash's `desks` field (#592). */
  function traceKeysOf(lobbyId: string, raw: string | undefined) {
    return raw
      ? raceDesksSchema.parse(JSON.parse(raw)).map(({ desk }) => traceKey(lobbyId, desk))
      : [];
  }

  async function voidRoom(lobbyId: string, extraDesks: readonly number[] = []) {
    const room = await redis.hgetall(roomKey(lobbyId));
    const stored = room.desks
      ? raceDesksSchema.parse(JSON.parse(room.desks)).map(({ desk }) => desk)
      : [];
    const traces = [...new Set([...stored, ...extraDesks])].map((desk) => traceKey(lobbyId, desk));
    const resume = Object.values(await redis.hgetall(resumeIndexKey(lobbyId))).map(resumeKey);
    const leftovers = [desksKey(lobbyId), resumeIndexKey(lobbyId), ...traces, ...resume];
    if (!room.openedAt) {
      await execAll(
        lobbyId,
        redis
          .multi()
          .del(roomKey(lobbyId), membersKey(lobbyId), ...leftovers)
          .srem(ROOMS_KEY, lobbyId),
      );
      openRooms.delete(lobbyId);
      return { lost: true };
    }
    await execAll(
      lobbyId,
      redis
        .multi()
        .hset(roomKey(lobbyId), {
          phase: "ended",
          endReason: "void" satisfies EndReason,
          endedAt: String(clock.now()),
        })
        .hdel(roomKey(lobbyId), "race", "t0", "endAt", "desks", "owner")
        .del(...leftovers)
        .expire(roomKey(lobbyId), VOID_TTL_S)
        .expire(membersKey(lobbyId), VOID_TTL_S),
    );
    openRooms.add(lobbyId);
    return { lost: false };
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
            .hsetnx(key, "settings", JSON.stringify(settings))
            .sadd(ROOMS_KEY, lobbyId),
        );
        const created = openedAt === 1;
        // Only a new room seats the bots of its settings; a re-open leaves the seats alone.
        if (created && settings.bots.length) {
          await withTtl(
            lobbyId,
            seatBots(
              redis.multi(),
              lobbyId,
              await readSeats(lobbyId),
              settings.bots,
              settings.language,
            ),
          );
        }
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
        // Belt and braces: token subs are web-minted cuids, the `bot:` space is the bots'.
        if (isBotUserId(userId)) return { ok: false, reason: "bot-id" };
        const room = await readRoom(lobbyId);
        if (!room) return { ok: false, reason: "no-room" };
        const settings = parseSettings(lobbyId, room.settings);
        const phase = parsePhase(room.phase);
        const seats = await readSeats(lobbyId);
        // Lenient: only admission and the desk preference read it; unreadable means "nobody raced".
        const desks =
          room.desks === undefined
            ? null
            : (raceDesksSchema.safeParse(JSON.parse(room.desks)).data ?? null);
        // Defence in depth behind the handshake: during a race only existing members come back;
        // `waiting` and `ended` seat anyone (#143, #732).
        if (!mayRejoin({ phase }, seats.has(userId))) {
          return { ok: false, reason: "in-progress" };
        }
        if (seatsFull([...seats.values()], seats.has(userId))) {
          return { ok: false, reason: "room-full" };
        }
        const taken = [...seats.values()].map((s) => s.desk);
        // A racer coming back after the end gets the desk it raced at when it is still free; a
        // newcomer in `ended` (#732) skips the last race's desks, so it never takes a racer's.
        const raced = desks?.find((d) => d.userId === userId)?.desk;
        const held =
          phase === "ended" && raced === undefined ? (desks ?? []).map((d) => d.desk) : [];
        const desk =
          seats.get(userId)?.desk ??
          (raced !== undefined && !taken.includes(raced) ? raced : nextDesk([...taken, ...held]));
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
        if (!room) return { members: [], closed: false, kept: false };
        const removed = await redis.hdel(membersKey(lobbyId), userId);
        const seats = await readSeats(lobbyId);
        const humans = [...seats.values()].filter((s) => !s.isBot).length;
        if (removed === 1 && humans === 0) {
          // The trace lists (#592) of the last race's desks go with the room.
          const traces = traceKeysOf(lobbyId, room.desks);
          if (room.phase === "ended") {
            // "Race again" (#143): the ended room waits for its members under a short TTL; the
            // race's mirror is never read back, so it goes now.
            await execAll(
              lobbyId,
              redis
                .multi()
                .del(desksKey(lobbyId), ...traces)
                .expire(roomKey(lobbyId), ENDED_GRACE_TTL_S)
                .expire(membersKey(lobbyId), ENDED_GRACE_TTL_S)
                .expire(ROOMS_KEY, ROOM_TTL_S),
            );
            return { members: toMembers(seats, room.hostUserId), closed: false, kept: true };
          }
          await execAll(
            lobbyId,
            redis
              .multi()
              .del(roomKey(lobbyId), membersKey(lobbyId), desksKey(lobbyId), ...traces)
              .srem(ROOMS_KEY, lobbyId),
          );
          openRooms.delete(lobbyId);
          return { members: [], closed: true, kept: false };
        }
        await withTtl(lobbyId, redis.multi());
        return { members: toMembers(seats, room.hostUserId), closed: false, kept: false };
      }),

    setBots: (lobbyId, bots) =>
      serial(lobbyId, async (): Promise<SetBotsResult> => {
        const room = await readRoom(lobbyId);
        if (!room) return { ok: false, reason: "no-room" };
        if (parsePhase(room.phase) !== "waiting") return { ok: false, reason: "not-waiting" };
        const parsed = botsSchema.safeParse(bots);
        if (!parsed.success) return { ok: false, reason: "invalid" };
        const settings = { ...parseSettings(lobbyId, room.settings), bots: parsed.data };
        const seats = await readSeats(lobbyId);
        if (botsOverflow(seats, parsed.data)) return { ok: false, reason: "invalid" };
        const tx = redis.multi().hset(roomKey(lobbyId), "settings", JSON.stringify(settings));
        await withTtl(lobbyId, seatBots(tx, lobbyId, seats, parsed.data, settings.language));
        return { ok: true, members: toMembers(seats, room.hostUserId) };
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
        const current = parseSettings(lobbyId, room.settings);
        const merged = raceSettingsSchema.safeParse({ ...current, ...clean });
        if (!merged.success) return { ok: false, reason: "invalid" };
        const renamed = merged.data.language !== current.language && merged.data.bots.length > 0;
        const seats = "bots" in clean || renamed ? await readSeats(lobbyId) : null;
        // Every desk counts, bots too (#732): a bots patch never seats past ROOM_SEATS.
        if (seats && botsOverflow(seats, merged.data.bots)) return { ok: false, reason: "invalid" };
        const tx = redis.multi().hset(roomKey(lobbyId), "settings", JSON.stringify(merged.data));
        if (!seats) {
          await withTtl(lobbyId, tx);
          return { ok: true, settings: merged.data };
        }
        // A bots patch, or a language change in a room with bots, re-seats in the same step and
        // the same MULTI (#156): bot names follow the race language (#361).
        const { bots, language } = merged.data;
        await withTtl(lobbyId, seatBots(tx, lobbyId, seats, bots, language));
        return { ok: true, settings: merged.data, members: toMembers(seats, room.hostUserId) };
      }),

    withRoom: serial,

    room: async (lobbyId) => {
      const room = await readRoom(lobbyId);
      if (!room) return null;
      const seats = await readSeats(lobbyId);
      return {
        code: room.code,
        hostUserId: room.hostUserId,
        phase: parsePhase(room.phase),
        settings: parseSettings(lobbyId, room.settings),
        race: parseRace(room.race),
        endAt: room.endAt === undefined ? null : msSchema.parse(Number(room.endAt)),
        seated: toDesks(seats),
        desks: room.desks === undefined ? null : raceDesksSchema.parse(JSON.parse(room.desks)),
        raceId: room.raceId ?? null,
        endReason: room.endReason === undefined ? null : endReasonSchema.parse(room.endReason),
        autoStartAt:
          room.autoStartAt === undefined ? null : msSchema.parse(Number(room.autoStartAt)),
      };
    },

    hasMember: async (lobbyId, userId) => (await redis.hexists(membersKey(lobbyId), userId)) === 1,

    botLevels: async (lobbyId) =>
      new Map(
        [...(await readSeats(lobbyId)).values()].flatMap(({ desk, isBot, level }) =>
          isBot && level ? [[desk, level] as const] : [],
        ),
      ),

    startRace: async (lobbyId, { race, endAt, desks }) => {
      // "Race again" (#143): nothing of the previous race survives into this one: its end fields,
      // its desks mirror and the trace lists of its desks and of this race's (ADR 0016).
      const previous = await redis.hget(roomKey(lobbyId), "desks");
      const traces = [
        ...new Set([
          ...traceKeysOf(lobbyId, previous ?? undefined),
          ...desks.map(({ desk }) => traceKey(lobbyId, desk)),
        ]),
      ];
      await withTtl(
        lobbyId,
        redis
          .multi()
          // A start (the host's or the room's own, #814) ends any pending automatic start.
          .hdel(roomKey(lobbyId), "endReason", "endedAt", "autoStartAt")
          .del(desksKey(lobbyId), ...traces)
          .hset(roomKey(lobbyId), {
            phase: "countdown",
            ...(owner ? { owner: owner.id } : {}),
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

    setAutoStart: async (lobbyId, at) => {
      const tx = redis.multi();
      if (at === null) tx.hdel(roomKey(lobbyId), "autoStartAt");
      else tx.hset(roomKey(lobbyId), "autoStartAt", String(at));
      await withTtl(lobbyId, tx);
    },

    voidRoom,

    async rehydrate() {
      const done: Rehydrated = { kept: [], voided: [], gone: [], foreign: [] };
      for (const lobbyId of await redis.smembers(ROOMS_KEY)) {
        try {
          await serial(lobbyId, async () => {
            const room = await redis.hgetall(roomKey(lobbyId));
            if (!room.openedAt) {
              await redis.srem(ROOMS_KEY, lobbyId);
              openRooms.delete(lobbyId);
              return void done.gone.push(lobbyId);
            }
            if (RECOVERY[parsePhase(room.phase)] === "keep") {
              // A timer never outlives its process (ADR 0008, #814): the stale automatic start
              // goes; the room's next join arms it again (a room with no socket never starts).
              if (room.autoStartAt !== undefined) await redis.hdel(roomKey(lobbyId), "autoStartAt");
              openRooms.add(lobbyId);
              return void done.kept.push(lobbyId);
            }
            if (await ownedElsewhere(room.owner)) {
              foreign.add(lobbyId);
              return void done.foreign.push(lobbyId);
            }
            await voidRoom(lobbyId);
            done.voided.push(lobbyId);
            log("room voided", { lobby: lobbyId, cause: "restart" });
          });
        } catch (err) {
          // One corrupt room never stops the boot; it stays indexed for the next one.
          log("rehydrate failed", { lobby: lobbyId, err: String(err) });
        }
      }
      return done;
    },

    async reconcile() {
      const voided: Voided[] = [];
      const voidOrphan = async (lobbyId: string, raceId: string | undefined) => {
        await voidRoom(lobbyId);
        if (raceId) voided.push({ lobbyId, raceId });
        log("room voided", { lobby: lobbyId, cause: "owner gone" });
      };
      for (const lobbyId of [...foreign]) {
        await serial(lobbyId, async () => {
          const room = await redis.hgetall(roomKey(lobbyId));
          if (!room.openedAt) return void foreign.delete(lobbyId);
          const live = RECOVERY[parsePhase(room.phase)] === "void";
          if (live && (await ownedElsewhere(room.owner))) return;
          foreign.delete(lobbyId);
          if (!live) return void openRooms.add(lobbyId);
          await voidOrphan(lobbyId, room.raceId);
        });
      }
      for (const lobbyId of [...openRooms]) {
        await serial(lobbyId, async () => {
          const [phase, raceOwner, raceId, openedAt] = await redis.hmget(
            roomKey(lobbyId),
            "phase",
            "owner",
            "raceId",
            "openedAt",
          );
          if (phase === null && openedAt === null) {
            openRooms.delete(lobbyId);
            return void (await redis.srem(ROOMS_KEY, lobbyId));
          }
          // Waiting here when another process started its race (#704: the deployment draining).
          const parsed = phaseSchema.safeParse(phase);
          if (!parsed.success || RECOVERY[parsed.data] !== "void") return;
          if (await ownerGone(raceOwner ?? undefined)) {
            await voidOrphan(lobbyId, raceId ?? undefined);
          }
        });
      }
      return voided;
    },

    count: () => openRooms.size,
    ids: () => [...openRooms],
    release: (lobbyId) => void openRooms.delete(lobbyId),
  };
}
