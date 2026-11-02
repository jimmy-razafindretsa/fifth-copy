import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, type RaceSettings } from "@fifth-copy/protocol";
import type { HostSettingsResult } from "@/features/race";
import {
  BOUNDS,
  buildPatch,
  hostRows,
  IDLE_FORM,
  reduceForm,
  submitSetting,
  validate,
  type FormState,
} from "./settings-form";

// Contract of #110 C2-C4: the host's intent becomes one valid one-field patch (or nothing), its fate is
// one form state; the schema of `@fifth-copy/protocol` is the only rule (ADR 0007).
const S = (patch: Partial<RaceSettings> = {}): RaceSettings => ({
  ...DEFAULT_RACE_SETTINGS,
  ...patch,
});
const CUSTOM = {
  level: "custom",
  wordLength: "short",
  rareLetters: true,
  punctuationDensity: "heavy",
} as const;

describe("BOUNDS (read from the schema, never restated)", () => {
  it("words 10-500, timer 1-10 minutes", () => {
    expect(BOUNDS).toEqual({
      words: { min: 10, max: 500 },
      minutes: { min: 1, max: 10 },
      letters: { max: 12 },
    });
  });
});

describe("hostRows (C1, C3)", () => {
  it("defaults: every field but bots and lobbyType, no accents row, the backspace row", () => {
    expect(hostRows(S())).toEqual([
      "language",
      "textType",
      "wordCount",
      "difficulty",
      "practiceLetters",
      "includeNumbers",
      "includeSymbols",
      "includePunctuation",
      "timerS",
      "errorMode",
      "backspace",
      "bonuses",
    ]);
  });

  it("the accents row only in French; the recipe rows only while custom; no backspace in block", () => {
    const rows = hostRows(S({ language: "fr", difficulty: CUSTOM, errorMode: "block" }));
    expect(rows).toContain("accentEveryWord");
    expect(rows).toEqual(
      expect.arrayContaining([
        "difficulty.wordLength",
        "difficulty.rareLetters",
        "difficulty.punctuationDensity",
      ]),
    );
    expect(rows.indexOf("difficulty.wordLength")).toBe(rows.indexOf("difficulty") + 1);
    expect(rows).not.toContain("backspace");
    expect(hostRows(S())).not.toContain("difficulty.wordLength");
  });
});

describe("buildPatch (C2, C3)", () => {
  it("one field per patch, from each kind of control", () => {
    expect(buildPatch("language", "fr", S())).toEqual({ language: "fr" });
    expect(buildPatch("textType", "words", S())).toEqual({ textType: "words" });
    expect(buildPatch("includeNumbers", true, S())).toEqual({ includeNumbers: true });
    expect(buildPatch("wordCount", " 120 ", S())).toEqual({ wordCount: 120 });
    expect(buildPatch("timerS", "3", S())).toEqual({ timerS: 180 });
    expect(buildPatch("timerS", null, S({ timerS: 180 }))).toEqual({ timerS: null });
    expect(buildPatch("practiceLetters", "q z x", S())).toEqual({
      practiceLetters: ["q", "z", "x"],
    });
    expect(buildPatch("practiceLetters", "", S({ practiceLetters: ["q"] }))).toEqual({
      practiceLetters: [],
    });
  });

  it("an unchanged value builds nothing", () => {
    expect(buildPatch("language", "en", S())).toBeNull();
    expect(buildPatch("wordCount", "50", S())).toBeNull();
    expect(buildPatch("timerS", null, S())).toBeNull();
    expect(buildPatch("difficulty", "custom", S({ difficulty: CUSTOM }))).toBeNull();
  });

  it("a preset sends only its level; CUSTOM starts from NORMAL's middle recipe", () => {
    expect(buildPatch("difficulty", "hard", S({ difficulty: CUSTOM }))).toEqual({
      difficulty: { level: "hard" },
    });
    expect(buildPatch("difficulty", "custom", S())).toEqual({
      difficulty: {
        level: "custom",
        wordLength: "medium",
        rareLetters: false,
        punctuationDensity: "light",
      },
    });
  });

  it("a recipe row sends the whole current recipe with one field changed", () => {
    expect(buildPatch("difficulty.wordLength", "long", S({ difficulty: CUSTOM }))).toEqual({
      difficulty: { ...CUSTOM, wordLength: "long" },
    });
    expect(buildPatch("difficulty.rareLetters", false, S({ difficulty: CUSTOM }))).toEqual({
      difficulty: { ...CUSTOM, rareLetters: false },
    });
    // no recipe outside custom: nothing to change
    expect(buildPatch("difficulty.wordLength", "long", S())).toBeNull();
  });

  it("block sends the error mode and nothing about backspace", () => {
    expect(buildPatch("errorMode", "block", S())).toEqual({ errorMode: "block" });
  });

  it("letters keep their code points as typed (no normalisation)", () => {
    expect(buildPatch("practiceLetters", "é", S())).toEqual({
      practiceLetters: ["e", "́"],
    });
  });
});

describe("validate (C4)", () => {
  const error = (key: Parameters<typeof buildPatch>[0], raw: Parameters<typeof buildPatch>[1]) => {
    const patch = buildPatch(key, raw, S());
    expect(patch).not.toBeNull();
    const result = validate(patch!);
    return result.ok ? null : result.error;
  };

  it("a valid patch passes as parsed", () => {
    expect(validate({ wordCount: 120 })).toEqual({ ok: true, patch: { wordCount: 120 } });
    expect(validate({ timerS: null })).toEqual({ ok: true, patch: { timerS: null } });
  });

  it.each([["9"], ["501"], ["abc"], [""], ["12.5"], ["-20"]])("words %j -> words", (raw) => {
    expect(error("wordCount", raw)).toBe("words");
  });

  it.each([["0"], ["11"], ["x"], ["1.5"]])("timer %j minutes -> timer", (raw) => {
    expect(error("timerS", raw)).toBe("timer");
  });

  it("13 letters -> too many letters; a repeat or a non-letter -> letters", () => {
    expect(error("practiceLetters", "abcdefghijklm")).toBe("too-many-letters");
    expect(error("practiceLetters", "abcdefghijkl")).toBeNull();
    expect(error("practiceLetters", "aa")).toBe("letters");
    for (const raw of ["a1", "a,", "a!", "a\u0007", "a​", "é", "😀"]) {
      expect(error("practiceLetters", raw), JSON.stringify(raw)).toBe("letters");
    }
  });
});

describe("reduceForm (C2)", () => {
  const ok: HostSettingsResult = { ok: true, settings: S({ errorMode: "block" }) };

  it("idle -> pending(key) -> idle on ok", () => {
    const pending = reduceForm(IDLE_FORM, { type: "submit", key: "errorMode" });
    expect(pending).toEqual({ status: "pending", key: "errorMode" });
    expect(reduceForm(pending, { type: "ack", result: ok })).toEqual(IDLE_FORM);
  });

  it.each(["not-waiting", "invalid", "no-room", "timeout"] as const)(
    "%s -> error on the pending row",
    (reason) => {
      const pending: FormState = { status: "pending", key: "timerS" };
      expect(reduceForm(pending, { type: "ack", result: { ok: false, error: reason } })).toEqual({
        status: "error",
        key: "timerS",
        error: reason,
      });
    },
  );

  it("not-host hides the controls for good", () => {
    const pending: FormState = { status: "pending", key: "language" };
    const hidden = reduceForm(pending, { type: "ack", result: { ok: false, error: "not-host" } });
    expect(hidden).toEqual({ status: "hidden" });
    expect(reduceForm(hidden, { type: "submit", key: "language" })).toBe(hidden);
  });

  it("a local refusal is an error without a send; a new submit clears it", () => {
    const refused = reduceForm(IDLE_FORM, { type: "refuse", key: "wordCount", error: "words" });
    expect(refused).toEqual({ status: "error", key: "wordCount", error: "words" });
    expect(reduceForm(refused, { type: "submit", key: "language" })).toEqual({
      status: "pending",
      key: "language",
    });
  });

  it("one patch in flight: a submit while pending is ignored", () => {
    const pending: FormState = { status: "pending", key: "language" };
    expect(reduceForm(pending, { type: "submit", key: "textType" })).toBe(pending);
  });
});

describe("submitSetting with a fake RoomSocket (C2, C4)", () => {
  function harness(result: HostSettingsResult, form: FormState = IDLE_FORM) {
    const send = vi.fn(async () => result);
    let state = form;
    const dispatch = vi.fn((e: Parameters<typeof reduceForm>[1]) => {
      state = reduceForm(state, e);
    });
    return { send, dispatch, state: () => state };
  }

  it("a valid change is sent once, pending until the ack", async () => {
    const h = harness({ ok: true, settings: S({ errorMode: "block" }) });
    const done = submitSetting({ ...h, form: IDLE_FORM, settings: S() }, "errorMode", "block");
    expect(h.state()).toEqual({ status: "pending", key: "errorMode" });
    await done;
    expect(h.send).toHaveBeenCalledExactlyOnceWith({ errorMode: "block" });
    expect(h.state()).toEqual(IDLE_FORM);
  });

  it.each(["not-waiting", "invalid", "no-room", "timeout"] as const)(
    "a %s ack leaves the error line",
    async (error) => {
      const h = harness({ ok: false, error });
      await submitSetting({ ...h, form: IDLE_FORM, settings: S() }, "timerS", "3");
      expect(h.state()).toEqual({ status: "error", key: "timerS", error });
    },
  );

  it("not-host hides the form", async () => {
    const h = harness({ ok: false, error: "not-host" });
    await submitSetting({ ...h, form: IDLE_FORM, settings: S() }, "language", "fr");
    expect(h.state()).toEqual({ status: "hidden" });
  });

  it("invalid input never leaves the page", async () => {
    const h = harness({ ok: true, settings: S() });
    await submitSetting({ ...h, form: IDLE_FORM, settings: S() }, "wordCount", "9000");
    await submitSetting({ ...h, form: h.state(), settings: S() }, "practiceLetters", "a1");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ status: "error", key: "practiceLetters", error: "letters" });
  });

  it("nothing is sent while pending, hidden, or for an unchanged value", async () => {
    const h = harness({ ok: true, settings: S() });
    await submitSetting(
      { ...h, form: { status: "pending", key: "language" }, settings: S() },
      "errorMode",
      "block",
    );
    await submitSetting({ ...h, form: { status: "hidden" }, settings: S() }, "errorMode", "block");
    await submitSetting({ ...h, form: IDLE_FORM, settings: S() }, "errorMode", "continue");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
