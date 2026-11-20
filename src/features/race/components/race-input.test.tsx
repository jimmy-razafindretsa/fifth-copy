import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Welcome,
} from "@fifth-copy/protocol";
import { describe, expect, it } from "vitest";
import { createKeyComposer } from "../client/input/compose-keys";
import { loadFixtures } from "../client/input/fixtures";
import type { Keystroke } from "../client/prediction";
import { createRaceStore, type RaceTimer } from "../client/store";
import { createTyping } from "../client/typing";
import { selectMachineProps } from "../view/machine-props";
import { isPlayKey, keyOf, RaceInput, routeInputEvent, TYPING_SURFACE } from "./race-input";

// #559 C4, the markup and the key filter (the focus, the lock and the clipboard live in a browser:
// e2e/race/input.spec.ts).
const noop = () => {};
const html = (disabled: boolean) =>
  renderToStaticMarkup(<RaceInput disabled={disabled} onKey={noop} label="Text to type" />);
const down = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
  keyOf({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("RaceInput (#559 C4)", () => {
  it("is a named text input with every browser aid off", () => {
    const markup = html(false);
    expect(markup).toMatch(/^<input [^>]*\/?>$/);
    for (const attr of [
      'type="text"',
      'aria-label="Text to type"',
      'autoComplete="off"',
      'autoCorrect="off"',
      'autoCapitalize="off"',
      'spellCheck="false"',
      'inputMode="text"',
      "data-race-input",
    ]) {
      expect(markup.toLowerCase(), attr).toContain(attr.toLowerCase());
    }
    expect(markup).not.toContain("disabled");
    expect(markup).not.toMatch(/value=/);
  });

  it("is disabled while locked", () => {
    expect(html(true)).toMatch(/ disabled=""/);
  });

  it("is visually hidden, not removed (it keeps the focus and the keys)", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/features/race/components/race-input.module.css"),
      "utf8",
    );
    expect(css).toMatch(/clip: rect\(0, 0, 0, 0\)/);
    expect(css).toMatch(/width: 1px/);
    expect(css).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  it("takes printable characters and Backspace, as the layout produced them", () => {
    for (const k of ["a", "L", " ", "é", "ç", "«", "»", "'", "€", "9"]) expect(down(k), k).toBe(k);
    expect(down("Backspace")).toBe("Backspace");
    // AltGr on Windows reports Ctrl+Alt; Option on macOS reports Alt: both type a character
    expect(down("@", { ctrlKey: true, altKey: true })).toBe("@");
    expect(down("œ", { altKey: true })).toBe("œ");
  });

  it("ignores everything else: named keys, shortcuts, dead keys, composition", () => {
    for (const k of [
      "Shift",
      "Enter",
      "Tab",
      "Escape",
      "ArrowLeft",
      "Dead",
      "Unidentified",
      "F5",
      "Meta",
    ]) {
      expect(down(k), k).toBeNull();
    }
    expect(down("v", { ctrlKey: true })).toBeNull();
    expect(down("v", { metaKey: true })).toBeNull();
    expect(down("c", { metaKey: true, altKey: true })).toBeNull();
    expect(
      keyOf({ key: "e", ctrlKey: false, metaKey: false, altKey: false, isComposing: true }),
    ).toBe(null);
  });

  it("names the typing surface by its three parts", () => {
    expect(TYPING_SURFACE).toBe("[data-telex], [data-sheet], [data-machine]");
  });
});

// Contract of #220 C6: the input carries the live error settings and your engine errors as data, so the
// e2e and later cards read them without a scoring copy.
describe("RaceInput live attributes (#220 C6)", () => {
  const live = (props: { mode?: "continue" | "block"; backspace?: boolean; errors?: number }) =>
    renderToStaticMarkup(<RaceInput disabled onKey={noop} label="Text to type" {...props} />);

  it("data-mode, data-backspace (on | off) and data-errors from its props", () => {
    const block = live({ mode: "block", backspace: true, errors: 3 });
    expect(block).toContain('data-mode="block"');
    expect(block).toContain('data-backspace="on"');
    expect(block).toContain('data-errors="3"');
    const off = live({ mode: "continue", backspace: false, errors: 0 });
    expect(off).toContain('data-mode="continue"');
    expect(off).toContain('data-backspace="off"');
    expect(off).toContain('data-errors="0"');
  });

  it("before the room's settings and your desk are known, none of them", () => {
    const out = live({});
    for (const attr of ["data-mode", "data-backspace", "data-errors"]) {
      expect(out, attr).not.toContain(attr);
    }
  });
});

// #236 C1: a bare Enter plays the Sabotage card and types nothing; Space and printable keys stay keys,
// and a modified or composing Enter does nothing (the handler itself runs in e2e/race/bonus.spec.ts).
describe("RaceInput play key (#951: Option/Alt + the card's letter)", () => {
  const press = (
    code: string,
    key: string,
    mods: Partial<
      Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing", boolean>
    > = {},
  ) => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it("Option/Alt + the card's letter plays it, matched on the physical key (Option's ˚ included)", () => {
    expect(isPlayKey(press("KeyK", "˚", { altKey: true }), "K")).toBe(true);
    expect(isPlayKey(press("KeyK", "k", { altKey: true }), "K")).toBe(true);
  });

  it("another letter, no card, or Cmd/Ctrl/Shift/AltGr/composition: never", () => {
    expect(isPlayKey(press("KeyJ", "j", { altKey: true }), "K")).toBe(false);
    expect(isPlayKey(press("KeyK", "k", { altKey: true }), null)).toBe(false);
    expect(isPlayKey(press("KeyK", "k"), "K")).toBe(false);
    for (const mod of ["ctrlKey", "metaKey", "shiftKey", "isComposing"] as const) {
      expect(isPlayKey(press("KeyK", "k", { altKey: true, [mod]: true }), "K"), mod).toBe(false);
    }
  });

  it("Enter no longer plays and types nothing", () => {
    expect(isPlayKey(press("Enter", "Enter"), "K")).toBe(false);
    expect(keyOf(press("Enter", "Enter"))).toBeNull();
  });
});

// Contract of #1001 C4: RaceInput routes every event through `composeKeys`. During a composition or a
// pending dead key the machine shows no `data-wrong` and the prediction receives nothing; at the commit
// one keystroke per committed NFC character is pushed and batched. (The DOM half: e2e/race/dead-keys.)
describe("RaceInput through composeKeys (#1001 C4)", () => {
  const SERVER_NOW = 1_767_225_600_000;

  /** A running Block race on `text`, typed through `createTyping` with a fake clock. */
  function race(text: string) {
    let now = SERVER_NOW;
    const due = new Map<number, { at: number; fn: () => void }>();
    let next = 0;
    const timer: RaceTimer = {
      now: () => now,
      setTimeout: (fn, ms) => {
        due.set(++next, { at: now + ms, fn });
        return next;
      },
      clearTimeout: (handle) => void due.delete(handle as number),
    };
    const advance = (ms: number) => {
      now += ms;
      for (const [id, job] of [...due].sort(([, a], [, b]) => a.at - b.at)) {
        if (job.at > now) continue;
        due.delete(id);
        job.fn();
      }
    };
    const store = createRaceStore();
    const welcome: Welcome = {
      v: PROTOCOL_VERSION,
      role: "player",
      you: 2,
      room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
      members: [],
      settings: { ...DEFAULT_RACE_SETTINGS, errorMode: "block" },
      race: null,
      state: null,
      overlay: null,
      bonus: null,
      resumeKey: null,
      serverNow: SERVER_NOW,
      autoStartAt: null,
      pending: null,
    };
    store.dispatch({ type: "welcome", payload: welcome, receivedAt: now });
    const raceInfo = {
      raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
      text,
      language: "fr" as const,
      wordCount: 1,
      t0: SERVER_NOW + 1_000,
      timerS: null,
    };
    store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race: raceInfo } });
    advance(1_000);
    store.dispatch({ type: "go" });
    advance(200);
    const sent: Keystroke[][] = [];
    const typing = createTyping({ store, send: (batch) => sent.push(batch), timer });
    const composer = createKeyComposer();
    const pushed: string[] = [];
    const onKey = (key: string) => {
      pushed.push(key);
      typing.press(key);
    };
    return { store, composer, onKey, pushed, sent, advance };
  }

  const fixtures = loadFixtures().filter(({ fixture }) => fixture.case === "circumflex-e");

  it.each(fixtures.map(({ file, fixture }) => [file, fixture] as const))(
    "%s: nothing before the commit, one keystroke ê after it, batched",
    (_file, fixture) => {
      const { store, composer, onKey, pushed, sent, advance } = race("être");
      const before = store.getState().prediction;
      const commit = fixture.events.findIndex(
        (e) =>
          e.type === "compositionend" || (e.type === "beforeinput" && e.inputType === "insertText"),
      );
      expect(commit).toBeGreaterThan(0);
      for (const event of fixture.events.slice(0, commit)) {
        routeInputEvent(composer, event, onKey);
        const state = store.getState();
        expect(state.prediction, event.type).toBe(before);
        expect(selectMachineProps(state).wrong, event.type).toBeNull();
        expect(selectMachineProps(state).pressed, event.type).toBeNull();
      }
      expect(composer.pending).toBe(true);
      for (const event of fixture.events.slice(commit)) routeInputEvent(composer, event, onKey);
      expect(pushed).toEqual(["ê"]);
      const state = store.getState();
      expect(state.prediction?.state.cursor).toBe(1);
      expect(state.prediction?.state.errors).toBe(0);
      expect(selectMachineProps(state).wrong).toBeNull();
      expect(sent).toEqual([]);
      advance(60);
      expect(sent.flat().map((k) => k.key)).toEqual(["ê"]);
    },
  );

  it("a decomposed commit (e + U+0302) is one NFC keystroke", () => {
    const { composer, onKey, pushed, store } = race("être");
    const ev = { key: null, code: null, isComposing: null, inputType: null } as const;
    routeInputEvent(composer, { ...ev, type: "compositionstart", data: "" }, onKey);
    routeInputEvent(composer, { ...ev, type: "compositionend", data: "e\u0302" }, onKey);
    expect(pushed).toEqual(["ê"]);
    expect(store.getState().prediction?.state.cursor).toBe(1);
  });

  it("c then a composed ç: one wrong keystroke, then one correct", () => {
    const { composer, onKey, store, advance, sent } = race("ça");
    const kd = { code: null, data: null, inputType: null, isComposing: false } as const;
    expect(routeInputEvent(composer, { ...kd, type: "keydown", key: "c" }, onKey)).toBe(true);
    expect(store.getState().prediction?.state.errors).toBe(1);
    expect(selectMachineProps(store.getState()).wrong).toBe("c");
    const ev = { key: null, code: null, isComposing: null, inputType: null } as const;
    routeInputEvent(composer, { ...ev, type: "compositionstart", data: "" }, onKey);
    routeInputEvent(composer, { ...ev, type: "compositionupdate", data: "¸" }, onKey);
    routeInputEvent(composer, { ...ev, type: "compositionend", data: "ç" }, onKey);
    const after = store.getState().prediction!;
    expect(after.state.cursor).toBe(1);
    expect(after.state.errors).toBe(1);
    expect(after.state.correct).toBe(1);
    advance(60);
    expect(sent.flat().map((k) => k.key)).toEqual(["c", "ç"]);
  });
});
