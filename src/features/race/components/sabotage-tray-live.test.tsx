import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COOLDOWN_MS } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  roomCodeSchema,
  type Welcome,
} from "@fifth-copy/protocol";
import { createRaceStore, type RaceEvent, type RaceStore } from "../client/store";
import { RaceStoreProvider } from "../client/use-race-store";
import { hudLabelFixtures } from "../view/hud-labels";
import {
  COOLDOWN_SAMPLE_MS,
  cooldownSecondsAt,
  createCooldownSampler,
  SabotageTrayLive,
  trayHidden,
} from "./sabotage-tray-live";

// Contract of #236 C3: the live tray shows the earned card with `ENTER TO PLAY`, the cooldown seconds
// counting down once per second (a sampler on an injected clock, the nixie recipe), the refusal, and no
// tray when the host turned bonuses off. The markup of each state is sabotage-tray.test.tsx's; the
// browser path (Enter, the button, the shake) is e2e/race/bonus.spec.ts's.
const SERVER_NOW = 1_767_225_600_000;
const T0 = SERVER_NOW + 3_000;
const welcome = (over: Partial<Welcome> = {}): Welcome => ({
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
  ...over,
});
const RACE = {
  raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
  text: "one two three four five six",
  language: "en" as const,
  wordCount: 6,
  t0: T0,
  timerS: null,
};
const event = (payload: Record<string, unknown>, at: number): RaceEvent =>
  ({ type: "event", payload: { v: PROTOCOL_VERSION, ...payload }, at }) as RaceEvent;

function fakeTimer(start = T0) {
  let now = start;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    timer: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        due.set(++next, { at: now + ms, fn });
        return next;
      },
      clearTimeout: (handle: unknown) => void due.delete(handle as number),
    },
    get now() {
      return now;
    },
    get pending() {
      return due.size;
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const first = [...due].sort(([, a], [, b]) => a.at - b.at)[0];
        if (!first || first[1].at > until) break;
        due.delete(first[0]);
        now = Math.max(now, first[1].at);
        first[1].fn();
      }
      now = until;
    },
  };
}

function racing(store: RaceStore = createRaceStore(), w = welcome()) {
  store.dispatch({ type: "welcome", payload: w, receivedAt: SERVER_NOW });
  store.dispatch({ type: "countdown", payload: { v: PROTOCOL_VERSION, race: RACE } });
  store.dispatch({ type: "go" });
  return store;
}

describe("SabotageTrayLive (#236 C3)", () => {
  const labels = hudLabelFixtures.en.sabotageTray;

  it("renders the empty tray on the server (before-start, the store's server snapshot)", () => {
    const html = renderToStaticMarkup(
      createElement(
        RaceStoreProvider,
        { store: racing() },
        createElement(SabotageTrayLive, { labels }),
      ),
    );
    expect(html).toContain('data-card="none"');
    expect(html).toContain("data-empty");
    expect(html).not.toContain("data-play");
  });

  it("settings.bonuses === false renders no tray; on, or before the settings, it shows", () => {
    const off = racing(
      createRaceStore(),
      welcome({ settings: { ...DEFAULT_RACE_SETTINGS, bonuses: false } }),
    );
    expect(trayHidden(off.getState())).toBe(true);
    expect(trayHidden(racing().getState())).toBe(false);
    expect(trayHidden(createRaceStore().getState())).toBe(false);
  });

  it("the cooldown seconds count down once per second from the play, then hold at 0", () => {
    const clock = fakeTimer();
    const store = racing();
    store.dispatch(event({ kind: "bonus-earned", desk: 2, bonus: "extra-paperwork" }, clock.now));
    const sampler = createCooldownSampler(store, { timer: clock.timer });
    const seen: number[] = [];
    sampler.subscribe(() => seen.push(sampler.read()));
    expect(sampler.read()).toBe(0);
    expect(clock.pending).toBe(0); // no cooldown: no clock
    store.dispatch({ type: "bonus-play", at: clock.now });
    expect(sampler.read()).toBe(COOLDOWN_MS / 1_000);
    for (let i = 0; i < COOLDOWN_MS / COOLDOWN_SAMPLE_MS; i++) clock.advance(COOLDOWN_SAMPLE_MS);
    expect(seen).toEqual(Array.from({ length: 16 }, (_, i) => 15 - i));
    // a key re-renders nothing: the seconds change only with the clock
    const before = seen.length;
    store.dispatch({ type: "key", keystroke: { t: 10, key: "o" } });
    expect(seen.length).toBe(before);
    clock.advance(5 * COOLDOWN_SAMPLE_MS);
    expect(seen.length).toBe(before);
  });

  it("cooldownSecondsAt rounds up and never goes below 0", () => {
    const s = racing().getState();
    const at = (until: number | null, now: number) =>
      cooldownSecondsAt({ ...s, bonus: { ...s.bonus, cooldownUntil: until } }, now);
    expect(at(null, 0)).toBe(0);
    expect(at(10_000, 0)).toBe(10);
    expect(at(10_000, 1)).toBe(10);
    expect(at(10_000, 9_001)).toBe(1);
    expect(at(10_000, 10_000)).toBe(0);
    expect(at(10_000, 99_000)).toBe(0);
  });
});
