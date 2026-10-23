import { describe, expect, it } from "vitest";
import { DEFAULT_RACE_SETTINGS, PROTOCOL_VERSION, roomCodeSchema } from "@fifth-copy/protocol";
import {
  initialRaceState,
  reduceRace,
  selectTypedView,
  type RaceEvent,
  type RaceState,
} from "../client/store";
import { selectMachineProps } from "./machine-props";

// Contract of #220 C2: the machine's live props come from one pure, memoised selector over the race
// store. `wrong` is the last key the engine counted as an error, lower-cased to match `data-key`;
// `jammed` is the typed view's jam; `pressed` (#224 C3) is the last key, lower-cased the same way.
const TEXT = "Le reçu";
const RACE = {
  raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
  text: TEXT,
  language: "fr" as const,
  wordCount: 2,
  t0: 1_767_225_603_000,
  timerS: null,
};

const raceIn = (errorMode: "continue" | "block") =>
  [
    {
      type: "welcome",
      payload: {
        v: PROTOCOL_VERSION,
        role: "player",
        you: 5,
        room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
        members: [],
        settings: { ...DEFAULT_RACE_SETTINGS, errorMode },
        race: null,
        state: null,
        overlay: null,
        resumeKey: null,
        serverNow: 1_767_225_600_000,
      },
    },
    { type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } },
    { type: "go" },
  ].reduce((s, e) => reduceRace(s, e as RaceEvent), initialRaceState);
const press = (s: RaceState, key: string, t: number) =>
  reduceRace(s, { type: "key", keystroke: { t, key } });

describe("selectMachineProps (#220 C2)", () => {
  it("returns exactly { pressed, wrong, jammed, finished }; nothing on before a race", () => {
    const props = selectMachineProps(initialRaceState);
    expect(props).toEqual({ pressed: null, wrong: null, jammed: false, finished: false });
    expect(Object.keys(props).sort()).toEqual(["finished", "jammed", "pressed", "wrong"]);
    expect(selectMachineProps(raceIn("block"))).toEqual(props);
  });

  it("Block: the refused key reads wrong and the machine jams (the typed view's jam); the right key clears both", () => {
    const jammed = press(raceIn("block"), "x", 10);
    expect(selectMachineProps(jammed)).toEqual({
      pressed: "x",
      wrong: "x",
      jammed: true,
      finished: false,
    });
    expect(selectMachineProps(jammed).jammed).toBe(selectTypedView(jammed).jammed);
    const released = press(jammed, "L", 20);
    expect(selectMachineProps(released)).toMatchObject({ wrong: null, jammed: false });
    expect(selectMachineProps(released).jammed).toBe(selectTypedView(released).jammed);
  });

  it("Continue: the struck key reads wrong without a jam, until the next key", () => {
    const struck = press(raceIn("continue"), "x", 10);
    expect(selectMachineProps(struck)).toMatchObject({ wrong: "x", jammed: false });
    expect(selectMachineProps(press(struck, "e", 20)).wrong).toBeNull();
    expect(selectMachineProps(press(struck, "Backspace", 20)).wrong).toBeNull();
  });

  it("folds the struck key to lower case to match data-key (É reads é); the space bar is a space", () => {
    expect(selectMachineProps(press(raceIn("block"), "É", 10)).wrong).toBe("é");
    expect(selectMachineProps(press(raceIn("block"), "X", 10)).wrong).toBe("x");
    expect(selectMachineProps(press(raceIn("block"), " ", 10)).wrong).toBe(" ");
  });

  it("#224 C3 pressed: the last key the engine took, folded to lower case like data-key", () => {
    const block = raceIn("block");
    expect(selectMachineProps(press(block, "L", 10)).pressed).toBe("l");
    expect(selectMachineProps(press(block, "É", 10)).pressed).toBe("é");
    expect(selectMachineProps(press(block, " ", 10)).pressed).toBe(" ");
    // a refused Block key is pressed too (the cap goes down, the machine jams)
    expect(selectMachineProps(press(block, "x", 10))).toMatchObject({ pressed: "x", jammed: true });
    // Backspace is a key the engine took: it presses nothing on a machine without function keys
    const back = press(press(raceIn("continue"), "x", 10), "Backspace", 20);
    expect(selectMachineProps(back).pressed).toBe("backspace");
    // no key yet, and a key before GO the store refused: nothing pressed
    expect(selectMachineProps(raceIn("block")).pressed).toBeNull();
  });

  it("#224 C3 pressed is memoised with the other fields: one object per keystroke", () => {
    const s = press(raceIn("continue"), "L", 10);
    expect(selectMachineProps(s)).toBe(selectMachineProps(s));
    const again = press(s, "e", 20);
    expect(selectMachineProps(again).pressed).toBe("e");
    expect(selectMachineProps(again)).not.toBe(selectMachineProps(s));
  });

  it("finished once your desk typed the whole text", () => {
    const done = Array.from(TEXT).reduce((s, k, i) => press(s, k, 10 * (i + 1)), raceIn("block"));
    expect(done.prediction?.state.status).toBe("finished");
    expect(selectMachineProps(done)).toMatchObject({ finished: true, wrong: null, jammed: false });
  });

  it("is memoised on the fields it reads: equal fields give the same object, a keystroke a new one", () => {
    const s = press(raceIn("block"), "x", 10);
    const props = selectMachineProps(s);
    expect(selectMachineProps(s)).toBe(props);
    // a rival desk's snapshot (your desk unchanged) re-renders nothing
    const rival = reduceRace(s, {
      type: "snapshot",
      payload: { v: PROTOCOL_VERSION, t: 500, desks: [[1, 3, 3, 0, 0]], ranks: [1] },
    });
    expect(rival).not.toBe(s);
    expect(selectMachineProps(rival)).toBe(props);
    const sameFields: RaceState = { ...s, members: [] };
    expect(selectMachineProps(sameFields)).toBe(props);
    // the same wrong key again is a new keystroke: a new object (#224 reads it for the press)
    const again = press(s, "x", 20);
    expect(selectMachineProps(again)).toEqual(props);
    expect(selectMachineProps(again)).not.toBe(props);
    // two pages' stores read in turns keep their own objects (no thrash under useSyncExternalStore)
    const other = press(raceIn("continue"), "q", 10);
    const otherProps = selectMachineProps(other);
    expect(selectMachineProps(s)).toBe(props);
    expect(selectMachineProps(other)).toBe(otherProps);
    expect(selectMachineProps(initialRaceState)).toBe(selectMachineProps(initialRaceState));
  });
});
