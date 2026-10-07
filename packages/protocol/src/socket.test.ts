import { describe, expect, expectTypeOf, it } from "vitest";
import { initialState } from "@fifth-copy/engine";
import {
  clientAcks,
  clientEvents,
  DEFAULT_RACE_SETTINGS,
  handshakeAuthSchema,
  hostSettingsAckSchema,
  hostSettingsSchema,
  memberSchema,
  rejectReasonSchema,
  PROTOCOL_VERSION,
  rosterSchema,
  serverEvents,
  settingsSchema,
  welcomeSchema,
  countdownSchema,
  snapshotSchema,
  eventSchema,
  endedSchema,
  rejectedSchema,
  pongSchema,
  hostStartSchema,
  hostStartAckSchema,
  keysSchema,
  abandonSchema,
  bonusPlaySchema,
  pingSchema,
  type ClientToServerEvents,
  type HostStartAck,
  type HostSettingsAck,
  type Keys,
} from "./index";

const member = { desk: 1, name: "Ada", isHost: true, isBot: false, color: 0, marker: "circle" };
const member13 = { ...member, desk: 13, isHost: false, color: 0, marker: "square" };
const v = PROTOCOL_VERSION;
const settings = DEFAULT_RACE_SETTINGS;
const welcome = {
  v,
  role: "host",
  you: 1,
  room: { code: "KGB-4821", phase: "waiting" },
  members: [member, member13],
  settings,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: 1767225600000,
};
const running = {
  ...welcome,
  role: "player",
  room: { code: "KGB-4821", phase: "running" },
  race: {
    raceId: "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90",
    text: "Workers of the world, type.",
    language: "en",
    wordCount: 5,
    t0: 1767225600000,
    timerS: null,
  },
  state: initialState(),
  overlay: { extra: [], removed: [] },
  resumeKey: "0123456789abcdef".repeat(4),
};

describe("socket schemas", () => {
  it.each([
    ["handshake example", handshakeAuthSchema, { v, token: "jwt" }, true],
    ["handshake v: 1", handshakeAuthSchema, { v: 1, token: "jwt" }, false],
    ["handshake missing token", handshakeAuthSchema, { v }, false],
    [
      "handshake resume key",
      handshakeAuthSchema,
      { v, token: "jwt", resumeKey: "a".repeat(64) },
      true,
    ],
    ["handshake short resume key", handshakeAuthSchema, { v, token: "jwt", resumeKey: "a" }, false],
    [
      "handshake long resume key",
      handshakeAuthSchema,
      { v, token: "jwt", resumeKey: "a".repeat(65) },
      false,
    ],
    ["handshake oversize token", handshakeAuthSchema, { v, token: "a".repeat(4097) }, false],
    ["reject example", rejectReasonSchema, "bad-token", true],
    ["reject in-progress", rejectReasonSchema, "in-progress", true],
    ["reject wrong enum", rejectReasonSchema, "banned", false],
    ["member example", memberSchema, member, true],
    ["member desk 0", memberSchema, { ...member, desk: 0 }, false],
    ["member missing isHost", memberSchema, { desk: 1, name: "Ada" }, false],
    ["member missing isBot", memberSchema, { ...member, isBot: undefined }, false],
    ["member color 12", memberSchema, { ...member, color: 12 }, false],
    ["member wrong marker", memberSchema, { ...member, marker: "star" }, false],
    ["member identity not of its desk", memberSchema, { ...member13, marker: "circle" }, false],
    ["member empty name", memberSchema, { ...member, name: "" }, false],
    ["member oversize name", memberSchema, { ...member, name: "a".repeat(65) }, false],
    ["welcome example", welcomeSchema, welcome, true],
    ["welcome running", welcomeSchema, running, true],
    ["welcome spectator", welcomeSchema, { ...welcome, role: "spectator", you: null }, true],
    ["welcome wrong role", welcomeSchema, { ...welcome, role: "admin" }, false],
    ["welcome missing serverNow", welcomeSchema, { ...welcome, serverNow: undefined }, false],
    ["welcome missing race", welcomeSchema, { ...welcome, race: undefined }, false],
    ["welcome bad resume key", welcomeSchema, { ...welcome, resumeKey: "short" }, false],
    ["welcome v: 1", welcomeSchema, { ...welcome, v: 1 }, false],
    ["welcome previous v", welcomeSchema, { ...welcome, v: v - 1 }, false],
    ["welcome missing settings", welcomeSchema, { ...welcome, settings: undefined }, false],
    ["welcome missing you", welcomeSchema, { ...welcome, you: undefined }, false],
    [
      "welcome wrong phase",
      welcomeSchema,
      { ...welcome, room: { code: "KGB-4821", phase: "racing" } },
      false,
    ],
    [
      "welcome bad code",
      welcomeSchema,
      { ...welcome, room: { code: "KOB-4821", phase: "waiting" } },
      false,
    ],
    ["roster example", rosterSchema, { v, members: [member] }, true],
    ["roster v: 1", rosterSchema, { v: 1, members: [member] }, false],
    ["roster missing members", rosterSchema, { v }, false],
    ["settings example", settingsSchema, { v, settings }, true],
    ["settings previous v", settingsSchema, { v: v - 1, settings }, false],
    ["settings invalid", settingsSchema, { v, settings: { ...settings, wordCount: 5 } }, false],
    ["host:settings example", hostSettingsSchema, { v, patch: { timerS: 120 } }, true],
    ["host:settings empty patch", hostSettingsSchema, { v, patch: {} }, true],
    ["host:settings previous v", hostSettingsSchema, { v: v - 1, patch: {} }, false],
    [
      "host:settings patch with lobbyType",
      hostSettingsSchema,
      { v, patch: { lobbyType: "public" } },
      false,
    ],
    ["ack ok", hostSettingsAckSchema, { ok: true, settings }, true],
    ["ack ok without settings", hostSettingsAckSchema, { ok: true }, false],
    ["ack not-host", hostSettingsAckSchema, { ok: false, error: "not-host" }, true],
    ["ack not-waiting", hostSettingsAckSchema, { ok: false, error: "not-waiting" }, true],
    ["ack invalid", hostSettingsAckSchema, { ok: false, error: "invalid" }, true],
    ["ack no-room", hostSettingsAckSchema, { ok: false, error: "no-room" }, true],
    ["ack unknown error", hostSettingsAckSchema, { ok: false, error: "teapot" }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });

  it("maps every server event to its schema", () => {
    expect(serverEvents).toEqual({
      welcome: welcomeSchema,
      roster: rosterSchema,
      settings: settingsSchema,
      countdown: countdownSchema,
      snapshot: snapshotSchema,
      event: eventSchema,
      ended: endedSchema,
      rejected: rejectedSchema,
      pong: pongSchema,
    });
  });

  it("maps every client event to its schema, and the two acked ones to their ack", () => {
    expect(clientEvents).toEqual({
      "host:settings": hostSettingsSchema,
      "host:start": hostStartSchema,
      keys: keysSchema,
      abandon: abandonSchema,
      "bonus:play": bonusPlaySchema,
      ping: pingSchema,
    });
    expect(clientAcks).toEqual({
      "host:settings": hostSettingsAckSchema,
      "host:start": hostStartAckSchema,
    });
  });

  it("types the acked events with their ack and the others without one", () => {
    expectTypeOf<Parameters<ClientToServerEvents["host:start"]>[1]>().toEqualTypeOf<
      (a: HostStartAck) => void
    >();
    expectTypeOf<Parameters<ClientToServerEvents["host:settings"]>[1]>().toEqualTypeOf<
      (a: HostSettingsAck) => void
    >();
    expectTypeOf<Parameters<ClientToServerEvents["keys"]>>().toEqualTypeOf<[payload: Keys]>();
  });
});
