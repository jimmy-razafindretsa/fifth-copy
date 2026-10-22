import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RACE_SETTINGS, PROTOCOL_VERSION, roomCodeSchema } from "@fifth-copy/protocol";

// Contract of #220 C2: the live machine reads the race store through `selectMachineProps` and renders the
// skin seam with it. A static render reads the store's server snapshot (the before-start state), so the
// hook is wrapped to read the client snapshot: the markup then shows what the browser renders.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useSyncExternalStore: vi.fn((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()),
  };
});

const react = await import("react");
const { createRaceStore } = await import("../../client/store");
const { RaceStoreProvider } = await import("../../client/use-race-store");
const { selectMachineProps } = await import("../../view/machine-props");
const { TypingMachine } = await import("./typing-machine");
const { TypingMachineLive } = await import("./typing-machine-live");
type RaceStore = import("../../client/store").RaceStore;

const ROWS = [
  ["q", "w", "e", "x"],
  ["a", "s", "d", "l"],
];
const TEXT = "Le reçu";

function storeIn(errorMode: "continue" | "block", keys: string[] = []): RaceStore {
  const store = createRaceStore();
  store.dispatch({
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
  });
  store.dispatch({
    type: "countdown",
    payload: {
      v: PROTOCOL_VERSION,
      race: {
        raceId: "3b241101-e2bb-4255-8caf-4136c566a962",
        text: TEXT,
        language: "fr",
        wordCount: 2,
        t0: 1_767_225_603_000,
        timerS: null,
      },
    },
  });
  store.dispatch({ type: "go" });
  keys.forEach((key, i) => store.dispatch({ type: "key", keystroke: { t: 10 * (i + 1), key } }));
  return store;
}

const live = (store: RaceStore, skin?: "teleprinter") =>
  renderToStaticMarkup(
    <RaceStoreProvider store={store}>
      <TypingMachineLive rows={ROWS} skin={skin} />
    </RaceStoreProvider>,
  );

describe("TypingMachineLive (#220 C2)", () => {
  it("reads the store through selectMachineProps", () => {
    const store = storeIn("block", ["x"]);
    const spy = vi.mocked(react.useSyncExternalStore);
    spy.mockClear();
    live(store);
    expect(spy).toHaveBeenCalledTimes(1);
    const [subscribe, getSnapshot] = spy.mock.calls[0]!;
    expect(subscribe).toBe(store.subscribe);
    expect(getSnapshot()).toBe(selectMachineProps(store.getState()));
  });

  it("Block jammed: data-jammed on the root, data-wrong on the refused key, no key disabled or pressed", () => {
    const out = live(storeIn("block", ["X"]));
    expect(out).toMatch(/^<div data-machine="true" data-skin="teleprinter" data-jammed="true"/);
    expect(out.match(/data-wrong="true"/g)).toHaveLength(1);
    expect(out).toMatch(/data-key="x"[^>]*data-wrong="true"/);
    expect(out).not.toContain("data-disabled");
    expect(out).not.toContain("data-pressed");
    expect(out).toContain('data-part="jam"');
  });

  it("Continue struck: data-wrong on the key, no jam", () => {
    const out = live(storeIn("continue", ["x"]));
    expect(out).toMatch(/data-key="x"[^>]*data-wrong="true"/);
    expect(out).not.toContain("data-jammed");
    expect(out).not.toContain('data-part="jam"');
  });

  it("renders exactly the skin seam with the selected props and no disabled keys", () => {
    for (const keys of [[], ["x"], ["L", "x"], ["L", "e"]]) {
      for (const mode of ["continue", "block"] as const) {
        const store = storeIn(mode, keys);
        const { wrong, jammed } = selectMachineProps(store.getState());
        expect(live(store), `${mode} ${keys.join("")}`).toBe(
          renderToStaticMarkup(
            <TypingMachine
              rows={ROWS}
              pressed={null}
              wrong={wrong}
              jammed={jammed}
              disabledKeys={[]}
            />,
          ),
        );
      }
    }
    expect(live(storeIn("block"), "teleprinter")).toBe(live(storeIn("block")));
  });

  it("is a client leaf that reaches the machine only through the skin seam", () => {
    const tsx = readFileSync(
      path.join(process.cwd(), "src/features/race/components/machine/typing-machine-live.tsx"),
      "utf8",
    );
    expect(tsx).toMatch(/^"use client";/);
    expect(tsx).toMatch(/useRaceStore\(selectMachineProps\)/);
    const specs = [...tsx.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(specs.filter((s) => s.includes("skins"))).toEqual([]);
    expect(specs).toContain("./typing-machine");
  });
});
