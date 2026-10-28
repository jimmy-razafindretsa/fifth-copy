import {
  DEFAULT_RACE_SETTINGS,
  keystrokeSchema,
  MAX_LAG_MS,
  PLAYER_STATUS_CODES,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Welcome,
} from "@fifth-copy/protocol";
import { describe, expect, it } from "vitest";
import { createRaceStore, type RaceEvent, type RaceTimer } from "./store";
import { createTyping } from "./typing";
import type { Keystroke } from "./prediction";

// #559 C2 and C10, the wiring half: a DOM key becomes one engine keystroke with `t` in ms since GO on the
// corrected clock, is applied locally at once and leaves in a <= 50 ms batch; nothing before GO, nothing
// after the desk's own finish. (The batcher alone: key-batcher.test.ts; the page: e2e/race/input.spec.ts.)

const SERVER_NOW = 1_767_225_600_000;
const T0 = SERVER_NOW + 3_000;
const TEXT = "Le reçu";

const welcome = (): Welcome => ({
  v: PROTOCOL_VERSION,
  role: "player",
  you: 2,
  room: { code: roomCodeSchema.parse("KGB-4821"), phase: "waiting" },
  members: [],
  settings: DEFAULT_RACE_SETTINGS,
  race: null,
  state: null,
  overlay: null,
  resumeKey: null,
  serverNow: SERVER_NOW,
});

function setup({ offset = 250 }: { offset?: number } = {}) {
  // this device runs `offset` ms behind the server
  let now = SERVER_NOW - offset;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timer: RaceTimer = {
    now: () => now,
    setTimeout: (fn, ms) => {
      due.set(++next, { at: now + ms, fn });
      return next;
    },
    clearTimeout: (handle) => void due.delete(handle as number),
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const first = [...due].sort(([, a], [, b]) => a.at - b.at)[0];
      if (!first || first[1].at > until) break;
      due.delete(first[0]);
      now = first[1].at;
      first[1].fn();
    }
    now = until;
  };
  const store = createRaceStore();
  const events: RaceEvent[] = [];
  const dispatch = store.dispatch;
  store.dispatch = (e) => {
    events.push(e);
    dispatch(e);
  };
  store.dispatch({ type: "welcome", payload: welcome(), receivedAt: now });
  const race = {
    raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
    text: TEXT,
    language: "fr" as const,
    wordCount: 2,
    t0: T0,
    timerS: null,
  };
  store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race } });
  const sent: Keystroke[][] = [];
  const typing = createTyping({ store, send: (batch) => sent.push(batch), timer });
  const go = () => {
    // GO lands at t0 on the corrected clock
    advance(T0 - (now + offset));
    store.dispatch({ type: "go" });
  };
  return { store, typing, sent, events, advance, go };
}

describe("createTyping (#559)", () => {
  it("a key before GO is neither applied nor sent", () => {
    const { store, typing, sent, advance } = setup();
    typing.press("L");
    advance(1_000);
    expect(store.getState().prediction?.state.cursor).toBe(0);
    expect(sent).toEqual([]);
  });

  it("after GO a key is applied at once and sent within 50 ms, with t in ms since GO on the server clock", () => {
    const { store, typing, sent, advance, go, events } = setup();
    go();
    advance(1_234);
    typing.press("L");
    expect(store.getState().prediction?.state.cursor).toBe(1);
    expect(sent).toEqual([]);
    advance(50);
    expect(sent).toEqual([[{ t: 1_234, key: "L" }]]);
    // the store learns the batch left (the reconcile's ack window)
    expect(events.at(-1)).toEqual({ type: "sent", count: 1 });
    expect(store.getState().prediction?.sent).toBe(1);
  });

  it("consecutive keys carry increasing t", () => {
    const { typing, sent, advance, go } = setup();
    go();
    advance(500);
    typing.press("L");
    advance(60);
    typing.press("e");
    advance(60);
    const ts = sent.flat().map((k) => k.t);
    expect(ts).toEqual([500, 560]);
  });

  it("a key the engine refuses is not sent", () => {
    const { typing, sent, advance, go, store } = setup();
    go();
    for (const k of TEXT) {
      typing.press(k);
      advance(30);
    }
    expect(store.getState().prediction?.state.status).toBe("finished");
    advance(100);
    const before = sent.flat().length;
    typing.press("x");
    advance(100);
    expect(sent.flat().length).toBe(before);
  });

  it("the finishing key leaves at once; nothing after the finish", () => {
    const { typing, sent, advance, go } = setup();
    go();
    for (const k of TEXT.slice(0, -1)) {
      typing.press(k);
      advance(30);
    }
    advance(100);
    const count = sent.length;
    typing.press(TEXT.at(-1)!);
    expect(sent).toHaveLength(count + 1);
    expect(sent.at(-1)!.map((k) => k.key)).toEqual([TEXT.at(-1)]);
    typing.press("x");
    advance(1_000);
    expect(sent).toHaveLength(count + 1);
  });

  it("dispose flushes what is queued and sends nothing more", () => {
    const { typing, sent, advance, go } = setup();
    go();
    advance(100);
    typing.press("L");
    typing.dispose();
    expect(sent).toEqual([[{ t: 100, key: "L" }]]);
    typing.press("e");
    advance(1_000);
    expect(sent).toHaveLength(1);
  });
});

// #645 C3: the finish shown by the prediction is not final until the server agrees; when a snapshot
// brings the desk back to typing, the typing path takes and sends keys again.
// #645 C4: every key the typing path applies is a key the wire accepts (`keystrokeSchema`).
describe("createTyping after a reconcile, and wire-valid keys only (#645)", () => {
  it("C3: the prediction showed finished, a snapshot brings the desk back to typing: a key is applied and sent", () => {
    const { store, typing, sent, advance, go } = setup();
    go();
    for (const k of TEXT) {
      typing.press(k);
      advance(30);
    }
    expect(store.getState().prediction?.state.status).toBe("finished");
    const lastT = sent.flat().at(-1)!.t;
    // the server dropped the finishing key: its desk is one key short and still typing
    advance(MAX_LAG_MS + 100);
    store.dispatch({
      type: "snapshot",
      payload: {
        v: PROTOCOL_VERSION,
        t: lastT + MAX_LAG_MS + 100,
        desks: [[2, 6, 6, 0, PLAYER_STATUS_CODES.typing, 6]],
        ranks: [2],
      },
    });
    expect(store.getState().prediction?.state).toMatchObject({ cursor: 6, status: "typing" });
    const before = sent.flat().length;
    typing.press(TEXT.at(-1)!);
    expect(store.getState().prediction?.state.status).toBe("finished");
    advance(50);
    expect(
      sent
        .flat()
        .slice(before)
        .map((k) => k.key),
    ).toEqual([TEXT.at(-1)]);
  });

  it.each([
    ["a tab", "\t"],
    ["a line separator (U+2028)", " "],
    ["a byte order mark (U+FEFF)", "﻿"],
  ])("C4: %s the wire refuses is neither applied nor sent", (_, key) => {
    const { store, typing, sent, advance, go } = setup();
    expect(keystrokeSchema.safeParse({ t: 0, key }).success).toBe(false);
    go();
    typing.press("L");
    typing.press("e");
    advance(100);
    const prediction = store.getState().prediction;
    typing.press(key); // at the space of "Le reçu": the engine would take it as one
    advance(100);
    expect(store.getState().prediction).toBe(prediction);
    expect(sent.flat().map((k) => k.key)).toEqual(["L", "e"]);
    typing.press(" ");
    advance(100);
    expect(store.getState().prediction?.state.cursor).toBe(3);
    expect(sent.flat().map((k) => k.key)).toEqual(["L", "e", " "]);
  });
});
