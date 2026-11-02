import { describe, expect, it } from "vitest";
import * as engine from "./index";

const { ENGINE_VERSION } = engine;

// Wiring test: proves the workspace package resolves in Vitest and the version is well-formed.
describe("@fifth-copy/engine", () => {
  it("exposes a semver ENGINE_VERSION", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is at 0.4.0 (catch-up bonuses, text overlays, clean and adjusted WPM, #190)", () => {
    expect(ENGINE_VERSION).toBe("0.4.0");
  });

  it.each([
    "normalizeTypeable",
    "isTypeable",
    "TYPEABLE",
    "wordCount",
    "charsOf",
    "initialState",
    "applyKeystroke",
    "continueMode",
    "blockMode",
    "backspace",
    "wpm",
    "rawWpm",
    "accuracy",
    "progress",
    "elapsedFor",
    "compareResults",
    "rank",
    "placeOf",
    "traceCapOf",
    "analyseTrace",
    "replayTrace",
    "DEFAULT_THRESHOLDS",
    "mulberry32",
    "effectiveText",
    "wordsOf",
    "cleanAndAdjustedWpm",
    "finishIfDone",
    "eligibleBonus",
    "applyBonus",
    "canPlay",
    "canHit",
    "record",
    "BOT_LEVELS",
    "BOT_LEVEL_WPM",
    "botProfile",
    "nextBotKeystroke",
  ])("re-exports %s", (name) => {
    expect(engine).toHaveProperty(name);
  });

  it("exposes the bot interface (#729): a profile per level and its next key", () => {
    const profile: engine.BotProfile = engine.botProfile("officer");
    const level: engine.BotLevel = engine.BOT_LEVELS[2];
    expect(profile).toMatchObject({ level, targetWpm: engine.BOT_LEVEL_WPM.officer });
    const ctx: engine.BotContext = {
      chars: engine.charsOf("OK"),
      state: engine.initialState(),
      settings: { errorMode: "block", backspace: true },
      elapsedMs: 0,
    };
    const action: engine.BotAction | null = engine.nextBotKeystroke(
      profile,
      ctx,
      engine.mulberry32(1),
    );
    expect(action).toEqual({ key: "O", delayMs: 240 });
  });

  it("drives a keystroke end to end through the public entry point", () => {
    const text = engine.normalizeTypeable("\u00ABOK\u00BB");
    expect(text).toBe("«OK»");
    const s = ["«", "O", "K", "»"].reduce(
      (st, key, i) =>
        engine.applyKeystroke(st, { t: i, key }, text, { errorMode: "block", backspace: true }),
      engine.initialState(),
    );
    expect(s).toMatchObject({ status: "finished", correct: 4, errors: 0 });
  });
});
