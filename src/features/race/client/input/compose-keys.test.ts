import { describe, expect, it } from "vitest";
import { composeKeys, createKeyComposer, keyOf, type KeyEventLike } from "./compose-keys";
import { loadFixtures } from "./fixtures";

// Contract of #1001 C3: `composeKeys(events)` yields exactly each documented fixture's `expected`
// characters as keystrokes, nothing for a lone dead key, swallows Backspace during a composition, and
// handles both event models (composition events; `key === "Dead"` without composition).

const ev = (type: KeyEventLike["type"], f: Partial<KeyEventLike> = {}): KeyEventLike => ({
  type,
  key: null,
  code: null,
  isComposing: null,
  data: null,
  inputType: null,
  ...f,
});
const kd = (key: string, f: Partial<KeyEventLike> = {}) =>
  ev("keydown", { key, isComposing: false, ...f });
const insert = (data: string) => [
  ev("beforeinput", { inputType: "insertText", data }),
  ev("input", { inputType: "insertText", data }),
];
const compStart = (accent: string) => [
  kd("Dead", { altKey: true }),
  ev("compositionstart", { data: "" }),
  ev("compositionupdate", { data: accent }),
  ev("beforeinput", { inputType: "insertCompositionText", data: accent, isComposing: true }),
  ev("input", { inputType: "insertCompositionText", data: accent, isComposing: true }),
];

describe("composeKeys over the documented fixtures (#1001 C3)", () => {
  const fixtures = loadFixtures();
  it.each(fixtures.map(({ file, fixture }) => [file, fixture] as const))("%s", (_file, fixture) => {
    expect(composeKeys(fixture.events)).toEqual(Array.from(fixture.expected));
  });

  it("a lone dead key types nothing, in either model, and leaves the composer pending", () => {
    for (const events of [[kd("Dead"), ev("keyup", { key: "Dead" })], compStart("ˆ")]) {
      const composer = createKeyComposer();
      expect(events.flatMap((e) => composer.feed(e).keys)).toEqual([]);
      expect(composer.pending).toBe(true);
    }
  });

  it("the prefix of every fixture up to its commit types nothing (the accent alone is never a key)", () => {
    for (const { file, fixture } of fixtures) {
      const end = fixture.events.findIndex((e) => e.type === "compositionend");
      if (end < 0) continue;
      expect(composeKeys(fixture.events.slice(0, end)), file).toEqual([]);
    }
  });
});

describe("composeKeys, composition model", () => {
  it("swallows Backspace during a composition; a cancelled composition types nothing", () => {
    const events = [
      ...compStart("ˆ"),
      kd("Backspace", { isComposing: true }),
      ev("beforeinput", { inputType: "deleteCompositionText", isComposing: true }),
      ev("input", { inputType: "deleteCompositionText", isComposing: true }),
      ev("compositionend", { data: "" }),
    ];
    expect(composeKeys(events)).toEqual([]);
  });

  it("Backspace after the commit is a key again", () => {
    const events = [
      ...compStart("ˆ"),
      kd("ê", { isComposing: true, keyCode: 229 }),
      ev("compositionend", { data: "ê" }),
      kd("Backspace"),
    ];
    expect(composeKeys(events)).toEqual(["ê", "Backspace"]);
  });

  it("commits NFC: a decomposed `e` + U+0302 is one keystroke `ê`", () => {
    expect(composeKeys([...compStart("ˆ"), ev("compositionend", { data: "ê" })])).toEqual(["ê"]);
  });

  it("an accent that does not combine commits both characters, one keystroke each", () => {
    expect(composeKeys([...compStart("ˆ"), ev("compositionend", { data: "ˆx" })])).toEqual([
      "ˆ",
      "x",
    ]);
  });

  it("Firefox's input after compositionend and a stray 229 keydown for the commit type nothing more", () => {
    const events = [
      ...compStart("ˆ"),
      ev("compositionend", { data: "ê" }),
      ev("input", { inputType: "insertCompositionText", data: "ê", isComposing: false }),
      kd("ê", { keyCode: 229 }),
      kd("a"),
    ];
    expect(composeKeys(events)).toEqual(["ê", "a"]);
  });

  it("a keydown marked Process or 229 outside a composition is not a key", () => {
    expect(composeKeys([kd("Process"), kd("e", { keyCode: 229 })])).toEqual([]);
  });
});

describe("composeKeys, Dead key without composition", () => {
  it("the inserted text after the dead key types, not the next keydown's key", () => {
    // the CDP dead-key path: key "e" on the keydown, "ê" inserted
    expect(composeKeys([kd("Dead"), kd("e"), ...insert("ê")])).toEqual(["ê"]);
  });

  it("Backspace while the accent is armed cancels it and types nothing", () => {
    const composer = createKeyComposer();
    expect(composer.feed(kd("Dead")).keys).toEqual([]);
    const back = composer.feed(kd("Backspace"));
    expect(back).toEqual({ keys: [], preventDefault: true });
    expect(composer.pending).toBe(false);
    expect(composer.feed(kd("e")).keys).toEqual(["e"]);
  });

  it("Shift between the dead key and the letter keeps the accent armed (a capital Ê)", () => {
    expect(composeKeys([kd("Dead"), kd("Shift"), kd("E"), ...insert("Ê")])).toEqual(["Ê"]);
  });

  it("an accent that does not combine inserts both characters", () => {
    expect(composeKeys([kd("Dead"), kd("x"), ...insert("^x")])).toEqual(["^", "x"]);
  });
});

describe("composeKeys, plain keys", () => {
  it("a printable keydown types itself and asks to cancel its default; its replayed insert is not typed again", () => {
    const composer = createKeyComposer();
    expect(composer.feed(kd("é"))).toEqual({ keys: ["é"], preventDefault: true });
    expect(composer.feed(insert("é")[0]!)).toEqual({ keys: [], preventDefault: true });
    expect(composer.feed(insert("é")[1]!).keys).toEqual([]);
  });

  it("a virtual keyboard (Unidentified keydown) types through its beforeinput, Backspace through deleteContentBackward", () => {
    expect(
      composeKeys([
        kd("Unidentified"),
        ...insert("a"),
        kd("Unidentified"),
        ev("beforeinput", { inputType: "deleteContentBackward" }),
        ev("input", { inputType: "deleteContentBackward" }),
      ]),
    ).toEqual(["a", "Backspace"]);
  });

  it("an input without a beforeinput is typed from its data", () => {
    expect(composeKeys([ev("input", { inputType: "insertText", data: "ab" })])).toEqual(["a", "b"]);
  });

  it("shortcuts and named keys are not keys; AltGr and Option characters are", () => {
    expect(keyOf({ key: "v", ctrlKey: true })).toBeNull();
    expect(keyOf({ key: "v", metaKey: true })).toBeNull();
    expect(keyOf({ key: "Shift" })).toBeNull();
    expect(keyOf({ key: "Dead" })).toBeNull();
    expect(keyOf({ key: "«", ctrlKey: true, altKey: true })).toBe("«");
    expect(keyOf({ key: "œ", altKey: true })).toBe("œ");
  });
});

describe("composeKeys, live order (the keydown's insert was cancelled)", () => {
  it("an insert with no keydown after a typed key's keyup types (Playwright's ç, a virtual key)", () => {
    expect(composeKeys([kd("r"), ev("keyup", { key: "r" }), ...insert("ç"), kd("a")])).toEqual([
      "r",
      "ç",
      "a",
    ]);
  });

  it("an insert of another character right after a typed keydown still types", () => {
    expect(composeKeys([kd("r"), ...insert("ç")])).toEqual(["r", "ç"]);
  });
});

describe("compose-keys stays pure", () => {
  it("imports nothing (no zod, no socket, no store, no engine): the client input bundles it", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      `${process.cwd()}/src/features/race/client/input/compose-keys.ts`,
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
