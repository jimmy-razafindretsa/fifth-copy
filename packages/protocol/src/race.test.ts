import { describe, expect, it } from "vitest";
import { initialState, type PlayerStatus } from "@fifth-copy/engine";
import {
  bonusKindSchema,
  DESK_COLORS,
  deskIdentity,
  deskSchema,
  endReasonSchema,
  keystrokeSchema,
  MARKERS,
  markerSchema,
  MAX_DESKS,
  MAX_OVERLAY_WORDS,
  MAX_RACE_MS,
  nameSchema,
  MAX_TEXT_LENGTH,
  phaseSchema,
  PLAYER_STATUS_CODES,
  PLAYER_STATUSES,
  playerStateSchema,
  playerStatusSchema,
  raceInfoSchema,
  raceRoleSchema,
  rankingEntrySchema,
  resumeKeySchema,
  textOverlaySchema,
} from "./index";

const raceId = "3f0c8a52-6a3e-4c1b-9d7e-2b5f1e8a4c90";
const raceInfo = {
  raceId,
  text: "Workers of the world, type.",
  language: "en",
  wordCount: 5,
  t0: 1767225600000,
  timerS: null,
} as const;
const rankingEntry = {
  place: 1,
  desk: 3,
  name: "Ada",
  isBot: false,
  status: "finished",
  wpm: 62.5,
  rawWpm: 70,
  accuracy: 0.97,
  progress: 1,
  finishedAt: 41000,
} as const;
const state = { ...initialState(), cursor: 2, correct: 1, errors: 1, total: 2, typed: [null, "x"] };

describe("race value schemas", () => {
  it.each([
    ["desk 1", deskSchema, 1, true],
    ["desk max", deskSchema, MAX_DESKS, true],
    ["desk 0", deskSchema, 0, false],
    ["desk over max", deskSchema, MAX_DESKS + 1, false],
    ["desk 1.5", deskSchema, 1.5, false],
    ["role spectator", raceRoleSchema, "spectator", true],
    ["role wrong enum", raceRoleSchema, "admin", false],
    ["phase running", phaseSchema, "running", true],
    ["phase wrong enum", phaseSchema, "racing", false],
    ["status line-cut", playerStatusSchema, "line-cut", true],
    ["status wrong enum", playerStatusSchema, "kicked", false],
    ["marker diamond", markerSchema, "diamond", true],
    ["marker wrong enum", markerSchema, "star", false],
    ["bonus smoke-break", bonusKindSchema, "smoke-break", true],
    ["bonus wrong enum", bonusKindSchema, "vodka", false],
    ["end void", endReasonSchema, "void", true],
    ["end wrong enum", endReasonSchema, "aborted", false],
    ["resume key 64 hex", resumeKeySchema, "a".repeat(64), true],
    ["resume key 32", resumeKeySchema, "a".repeat(32), true],
    ["resume key 31", resumeKeySchema, "a".repeat(31), false],
    ["resume key 65", resumeKeySchema, "a".repeat(65), false],
    ["resume key junk", resumeKeySchema, `${"a".repeat(31)}/`, false],
    ["keystroke example", keystrokeSchema, { t: 12345, key: "é" }, true],
    ["keystroke backspace", keystrokeSchema, { t: 0, key: "Backspace" }, true],
    ["keystroke astral char", keystrokeSchema, { t: 1, key: "\u{1F600}" }, true],
    ["keystroke two chars", keystrokeSchema, { t: 1, key: "ab" }, false],
    ["keystroke modifier name", keystrokeSchema, { t: 1, key: "Shift" }, false],
    ["keystroke space", keystrokeSchema, { t: 1, key: " " }, true],
    ["keystroke NUL", keystrokeSchema, { t: 1, key: "\u0000" }, false],
    ["keystroke newline", keystrokeSchema, { t: 1, key: "\n" }, false],
    ["keystroke ESC", keystrokeSchema, { t: 1, key: "\u001B" }, false],
    ["keystroke DEL", keystrokeSchema, { t: 1, key: "\u007F" }, false],
    ["keystroke RLO", keystrokeSchema, { t: 1, key: "\u202E" }, false],
    ["keystroke line separator", keystrokeSchema, { t: 1, key: "\u2028" }, false],
    ["keystroke paragraph separator", keystrokeSchema, { t: 1, key: "\u2029" }, false],
    ["keystroke private use", keystrokeSchema, { t: 1, key: "\uE000" }, false],
    ["keystroke lone high surrogate", keystrokeSchema, { t: 1, key: "\uD800" }, false],
    ["keystroke lone low surrogate", keystrokeSchema, { t: 1, key: "\uDC00" }, false],
    ["keystroke t at race max", keystrokeSchema, { t: MAX_RACE_MS, key: "a" }, true],
    ["keystroke t over race max", keystrokeSchema, { t: MAX_RACE_MS + 1, key: "a" }, false],
    ["name example", nameSchema, "Fox-042", true],
    ["name with spaces and accents", nameSchema, "Élise Ŝ 🦊", true],
    ["name emoji ZWJ sequence", nameSchema, "\u{1F469}\u200D\u{1F4BB}", true],
    ["name NUL", nameSchema, "Ada\u0000", false],
    ["name newline", nameSchema, "Ada\nBob", false],
    ["name RLO", nameSchema, "\u202EadA", false],
    ["name bidi isolate", nameSchema, "\u2066Ada", false],
    ["name line separator", nameSchema, "Ada\u2028", false],
    ["name lone surrogate", nameSchema, "Ada\uD800", false],
    ["name empty", nameSchema, "", false],
    ["keystroke empty key", keystrokeSchema, { t: 1, key: "" }, false],
    ["keystroke negative t", keystrokeSchema, { t: -1, key: "a" }, false],
    ["keystroke fractional t", keystrokeSchema, { t: 1.5, key: "a" }, false],
    ["keystroke missing key", keystrokeSchema, { t: 1 }, false],
    ["overlay example", textOverlaySchema, { extra: ["form", "B-12"], removed: [3, 4] }, true],
    ["overlay empty", textOverlaySchema, { extra: [], removed: [] }, true],
    ["overlay missing removed", textOverlaySchema, { extra: [] }, false],
    ["overlay negative index", textOverlaySchema, { extra: [], removed: [-1] }, false],
    ["overlay empty word", textOverlaySchema, { extra: [""], removed: [] }, false],
    [
      "overlay too many words",
      textOverlaySchema,
      { extra: Array.from({ length: MAX_OVERLAY_WORDS + 1 }, () => "w"), removed: [] },
      false,
    ],
    ["race info example", raceInfoSchema, raceInfo, true],
    ["race info timer", raceInfoSchema, { ...raceInfo, timerS: 120 }, true],
    ["race info missing t0", raceInfoSchema, { ...raceInfo, t0: undefined }, false],
    ["race info bad language", raceInfoSchema, { ...raceInfo, language: "ru" }, false],
    ["race info not a uuid", raceInfoSchema, { ...raceInfo, raceId: "race_1" }, false],
    [
      "race info oversize text",
      raceInfoSchema,
      { ...raceInfo, text: "a".repeat(MAX_TEXT_LENGTH + 1) },
      false,
    ],
    ["state example", playerStateSchema, state, true],
    ["state initial", playerStateSchema, initialState(), true],
    ["state missing typed", playerStateSchema, { ...state, typed: undefined }, false],
    ["state wrong status", playerStateSchema, { ...state, status: "racing" }, false],
    ["state lastT over race max", playerStateSchema, { ...state, lastT: MAX_RACE_MS + 1 }, false],
    ["ranking example", rankingEntrySchema, rankingEntry, true],
    ["ranking not finished", rankingEntrySchema, { ...rankingEntry, finishedAt: null }, true],
    ["ranking missing wpm", rankingEntrySchema, { ...rankingEntry, wpm: undefined }, false],
    ["ranking accuracy 1.1", rankingEntrySchema, { ...rankingEntry, accuracy: 1.1 }, false],
    ["ranking wrong status", rankingEntrySchema, { ...rankingEntry, status: "won" }, false],
    ["ranking long name", rankingEntrySchema, { ...rankingEntry, name: "a".repeat(65) }, false],
  ] as const)("%s", (_, schema, payload, ok) => {
    expect(schema.safeParse(payload).success).toBe(ok);
  });
});

describe("race time cap", () => {
  it("is one hour: 500 words at 10 WPM plus margin, far above the 600 s timer maximum", () => {
    expect(MAX_RACE_MS).toBe(60 * 60 * 1000);
  });
});

describe("player status codes", () => {
  it("lists the engine statuses in engine order and maps them both ways", () => {
    const engineOrder: PlayerStatus[] = [
      "typing",
      "finished",
      "abandoned",
      "asleep",
      "line-cut",
      "expired",
    ];
    expect(PLAYER_STATUSES).toEqual(engineOrder);
    for (const [code, status] of PLAYER_STATUSES.entries()) {
      expect(PLAYER_STATUS_CODES[status]).toBe(code);
    }
  });
});

describe("deskIdentity", () => {
  const ids = Array.from({ length: 48 }, (_, i) => deskIdentity(i + 1));

  it("gives desks 1..48 distinct (color, marker) pairs", () => {
    expect(new Set(ids.map((id) => `${id.color}/${id.marker}`)).size).toBe(48);
  });

  it("cycles colours 0..11 and changes marker every 12 desks", () => {
    expect(DESK_COLORS).toBe(12);
    expect(ids.map((id) => id.color)).toEqual(
      Array.from({ length: 48 }, (_, i) => i % DESK_COLORS),
    );
    expect(ids.map((id) => id.marker)).toEqual(
      Array.from({ length: 48 }, (_, i) => MARKERS[Math.floor(i / 12)]),
    );
    expect(deskIdentity(49)).toEqual(deskIdentity(1));
  });
});
