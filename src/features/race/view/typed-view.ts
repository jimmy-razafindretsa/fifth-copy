/**
 * The typing surface's view model (#558, ADR 0013): what the telex strip, the typed sheet and the
 * typing machine render, and nothing else. It is data: #559 (`typedViewFrom`) derives it from the
 * engine state; no race rule lives here or in the components (ADR 0007).
 */

/** How one character of the race text reads (design bible 7.7). */
export type CharState = "done" | "wrong" | "next" | "remaining";

export type TypedChar = { ch: string; state: CharState };

/**
 * `chars`: the race text, one grapheme each, in order. `cursor`: the index of the `next` char
 * (`chars.length` once finished). `jammed`: Block mode refused the last key (the machine jams).
 * `lastTypedAt`: the time of the last accepted keystroke, `null` before the first one; it keys the pop of
 * the char at `cursor - 1`, so a retype at the same index pops again.
 */
export type TypedView = {
  chars: TypedChar[];
  cursor: number;
  jammed: boolean;
  lastTypedAt: number | null;
};

/**
 * The engine state a view reads (#559): the engine's `PlayerState` fits it. Declared here, structurally,
 * so this module stays free of the engine (#558 C10): it maps what the engine recorded, never compares a
 * key with the text (ADR 0007).
 */
export type TypedProgress = {
  readonly cursor: number;
  /** `typed[i]`: the struck key at `i` (Continue mode), `null` when it was right. */
  readonly typed: readonly (string | null)[];
  /** Key presses the engine took; 0 before the first one. */
  readonly total: number;
  /** `t` of the last one (ms since GO). */
  readonly lastT: number;
};

/** The typing surface with no text yet (before the countdown hands the race text over). */
export const NO_TEXT_VIEW: TypedView = { chars: [], cursor: 0, jammed: false, lastTypedAt: null };

/**
 * The view of a desk typing `text` (#559 C3): `done` / `wrong` before the cursor as the engine recorded
 * them, `next` at it, `remaining` after it; `jammed` from the prediction (Block mode, a refused key: a
 * state alone cannot tell it); `lastTypedAt` keys the pop of the last typed char.
 */
export function typedViewFrom(
  state: TypedProgress,
  text: string,
  { jammed = false }: { jammed?: boolean } = {},
): TypedView {
  const chars = Array.from(text, (ch, i): TypedChar => {
    if (i < state.cursor) return { ch, state: state.typed[i] == null ? "done" : "wrong" };
    return { ch, state: i === state.cursor ? "next" : "remaining" };
  });
  return {
    chars,
    cursor: Math.min(state.cursor, chars.length),
    jammed,
    lastTypedAt: state.total > 0 ? state.lastT : null,
  };
}

/** The fixture text: French, with the accents and guillemets a race text carries (é ç ê « »). */
const TEXT =
  "« Le reçu du café est prêt. » Le Major le signe à l'aube et classe la cinquième copie.";

/** Static fixture data only: `wrong` lists typed indices that were mistyped (Continue mode). */
function fixture(
  cursor: number,
  {
    wrong = [],
    jammed = false,
    lastTypedAt = null,
  }: Partial<{
    wrong: number[];
    jammed: boolean;
    lastTypedAt: number | null;
  }> = {},
): TypedView {
  const chars = Array.from(TEXT).map((ch, i): TypedChar => {
    if (i < cursor) return { ch, state: wrong.includes(i) ? "wrong" : "done" };
    return { ch, state: i === cursor ? "next" : "remaining" };
  });
  return { chars, cursor, jammed, lastTypedAt };
}

const LENGTH = Array.from(TEXT).length;

/** The race states of the `/design#race-typing` specimens and the component tests. */
export const typedViewFixtures = {
  "before-start": fixture(0),
  racing: fixture(34, { lastTypedAt: 12_400 }),
  // Continue mode: two slips stay on the copy, the last one just typed
  "continue-wrong": fixture(46, { wrong: [37, 45], lastTypedAt: 16_150 }),
  // Block mode: the cursor holds on the accent and the machine jams until the right key
  "block-jammed": fixture(48, { jammed: true, lastTypedAt: 18_900 }),
  finished: fixture(LENGTH, { lastTypedAt: 31_700 }),
} satisfies Record<string, TypedView>;

export type TypedViewFixture = keyof typeof typedViewFixtures;
