import { describe, expect, it } from "vitest";
import {
  abandonSchema,
  bonusPlaySchema,
  countdownSchema,
  endedSchema,
  eventSchema,
  hostStartAckSchema,
  hostStartSchema,
  keysSchema,
  MAX_KEYS_PER_BATCH,
  pingSchema,
  pongSchema,
  PROTOCOL_VERSION,
  rejectedSchema,
  snapshotSchema,
} from "./index";

const v = PROTOCOL_VERSION;
const race = {
  raceId: "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90",
  text: "Workers of the world, type.",
  language: "fr",
  wordCount: 5,
  t0: 1767225600000,
  timerS: 120,
};
const entry = {
  place: 1,
  desk: 3,
  name: "Ada",
  isBot: true,
  status: "finished",
  wpm: 50,
  rawWpm: 52,
  accuracy: 0.99,
  progress: 1,
  finishedAt: 30000,
};
const snapshot = {
  v,
  t: 1200,
  desks: [
    [1, 10, 9, 1, 0],
    [2, 27, 27, 0, 1],
  ],
  ranks: [2, 1],
};
const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i * 10, key: "a" }));
const overlay = { extra: ["form"], removed: [] };

const events = [
  { v, kind: "finished", desk: 1, place: 1 },
  { v, kind: "overtake", desk: 1, passed: 2 },
  { v, kind: "passed", desk: 2, by: 1 },
  { v, kind: "new-leader", desk: 1 },
  { v, kind: "new-host", desk: 2 },
  { v, kind: "line-cut", desk: 2 },
  { v, kind: "resumed", desk: 2 },
  { v, kind: "idle-warning", desk: 2, kickAt: 45000 },
  { v, kind: "asleep", desk: 2 },
  { v, kind: "abandoned", desk: 2 },
  { v, kind: "kicked", desk: 2 },
  { v, kind: "bonus-earned", desk: 2, bonus: "exemption" },
  { v, kind: "bonus-sent", from: 2, to: [1, 3], bonus: "extra-paperwork" },
  { v, kind: "bonus-hit", desk: 1, bonus: "extra-paperwork", overlay, blurUntil: null },
  { v, kind: "bonus-hit", desk: 1, bonus: "smoke-break", overlay: null, blurUntil: 9000 },
];

describe("race events", () => {
  it.each(events.map((e, i) => [`${e.kind} #${i}`, e] as const))("event %s parses", (_, e) => {
    expect(eventSchema.safeParse(e).success).toBe(true);
    expect(eventSchema.safeParse({ ...e, v: v - 1 }).success).toBe(false);
  });

  it.each([
    ["countdown example", countdownSchema, { v, race }, true],
    ["countdown previous v", countdownSchema, { v: v - 1, race }, false],
    ["countdown missing race", countdownSchema, { v }, false],
    ["snapshot example", snapshotSchema, snapshot, true],
    ["snapshot previous v", snapshotSchema, { ...snapshot, v: v - 1 }, false],
    ["snapshot missing ranks", snapshotSchema, { ...snapshot, ranks: undefined }, false],
    ["snapshot tuple of 4", snapshotSchema, { ...snapshot, desks: [[1, 10, 9, 1]] }, false],
    ["snapshot tuple of 6", snapshotSchema, { ...snapshot, desks: [[1, 10, 9, 1, 0, 0]] }, false],
    ["snapshot non-integer", snapshotSchema, { ...snapshot, desks: [[1, 10.5, 9, 1, 0]] }, false],
    [
      "snapshot unknown status code",
      snapshotSchema,
      { ...snapshot, desks: [[1, 1, 1, 0, 6]] },
      false,
    ],
    ["snapshot desk 0", snapshotSchema, { ...snapshot, desks: [[0, 1, 1, 0, 0]] }, false],
    ["event unknown kind", eventSchema, { v, kind: "teleported", desk: 1 }, false],
    ["event missing field", eventSchema, { v, kind: "overtake", desk: 1 }, false],
    ["event wrong bonus", eventSchema, { v, kind: "bonus-earned", desk: 1, bonus: "vodka" }, false],
    [
      "event empty bonus-sent",
      eventSchema,
      { v, kind: "bonus-sent", from: 1, to: [], bonus: "exemption" },
      false,
    ],
    [
      "ended example",
      endedSchema,
      { v, raceId: race.raceId, reason: "timer", ranking: [entry] },
      true,
    ],
    ["ended void", endedSchema, { v, raceId: race.raceId, reason: "void", ranking: [] }, true],
    [
      "ended previous v",
      endedSchema,
      { v: v - 1, raceId: race.raceId, reason: "timer", ranking: [] },
      false,
    ],
    [
      "ended wrong reason",
      endedSchema,
      { v, raceId: race.raceId, reason: "boredom", ranking: [] },
      false,
    ],
    ["ended missing ranking", endedSchema, { v, raceId: race.raceId, reason: "timer" }, false],
    ["rejected example", rejectedSchema, { v, reason: "before-go" }, true],
    ["rejected rate-limit", rejectedSchema, { v, reason: "rate-limit" }, true],
    ["rejected previous v", rejectedSchema, { v: v - 1, reason: "spectator" }, false],
    ["rejected wrong reason", rejectedSchema, { v, reason: "teapot" }, false],
    ["pong example", pongSchema, { v, sent: 5, serverNow: 1767225600000 }, true],
    ["pong previous v", pongSchema, { v: v - 1, sent: 5, serverNow: 1 }, false],
    ["pong missing serverNow", pongSchema, { v, sent: 5 }, false],
    ["host:start example", hostStartSchema, { v }, true],
    ["host:start previous v", hostStartSchema, { v: v - 1 }, false],
    ["host:start ack ok", hostStartAckSchema, { ok: true, raceId: race.raceId }, true],
    ["host:start ack ok without raceId", hostStartAckSchema, { ok: true }, false],
    ["host:start ack too-few", hostStartAckSchema, { ok: false, error: "too-few" }, true],
    ["host:start ack start-failed", hostStartAckSchema, { ok: false, error: "start-failed" }, true],
    ["host:start ack wrong error", hostStartAckSchema, { ok: false, error: "teapot" }, false],
    ["keys one", keysSchema, { v, batch: keys(1) }, true],
    ["keys max", keysSchema, { v, batch: keys(MAX_KEYS_PER_BATCH) }, true],
    [
      "keys out of order",
      keysSchema,
      {
        v,
        batch: [
          { t: 9, key: "a" },
          { t: 3, key: "b" },
        ],
      },
      true,
    ],
    ["keys 0", keysSchema, { v, batch: [] }, false],
    ["keys 65", keysSchema, { v, batch: keys(65) }, false],
    ["keys previous v", keysSchema, { v: v - 1, batch: keys(1) }, false],
    ["keys bad key", keysSchema, { v, batch: [{ t: 1, key: "Shift" }] }, false],
    ["abandon example", abandonSchema, { v }, true],
    ["abandon previous v", abandonSchema, { v: v - 1 }, false],
    ["bonus:play example", bonusPlaySchema, { v }, true],
    ["bonus:play previous v", bonusPlaySchema, { v: v - 1 }, false],
    ["ping example", pingSchema, { v, sent: 1234 }, true],
    ["ping previous v", pingSchema, { v: v - 1, sent: 1234 }, false],
    ["ping missing sent", pingSchema, { v }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it("caps a key batch at 64", () => {
    expect(MAX_KEYS_PER_BATCH).toBe(64);
  });
});
