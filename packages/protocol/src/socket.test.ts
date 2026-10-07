import { describe, expect, it } from "vitest";
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
} from "./index";

const member = { desk: 1, name: "Ada", isHost: true };
const v = PROTOCOL_VERSION;
const settings = DEFAULT_RACE_SETTINGS;
const welcome = {
  v,
  you: 1,
  room: { code: "KGB-4821", phase: "waiting" },
  members: [member],
  settings,
};

describe("socket schemas", () => {
  it.each([
    ["handshake example", handshakeAuthSchema, { v, token: "jwt" }, true],
    ["handshake v: 1", handshakeAuthSchema, { v: 1, token: "jwt" }, false],
    ["handshake missing token", handshakeAuthSchema, { v }, false],
    ["reject example", rejectReasonSchema, "bad-token", true],
    ["reject wrong enum", rejectReasonSchema, "banned", false],
    ["member example", memberSchema, member, true],
    ["member desk 0", memberSchema, { ...member, desk: 0 }, false],
    ["member missing isHost", memberSchema, { desk: 1, name: "Ada" }, false],
    ["welcome example", welcomeSchema, welcome, true],
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
    expect(serverEvents.welcome).toBe(welcomeSchema);
    expect(serverEvents.roster).toBe(rosterSchema);
    expect(serverEvents.settings).toBe(settingsSchema);
  });

  it("maps every client event to its schema and its ack", () => {
    expect(clientEvents["host:settings"]).toBe(hostSettingsSchema);
    expect(clientAcks["host:settings"]).toBe(hostSettingsAckSchema);
    expect(Object.keys(clientAcks)).toEqual(Object.keys(clientEvents));
  });
});
