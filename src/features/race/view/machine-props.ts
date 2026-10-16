/**
 * The typing machine's live props (#220, bible 7.7a, ADR 0013): what the skin seam `TypingMachine` draws
 * from the race store, and nothing else. Pure data mapping, like `typed-view.ts`: the engine decided the
 * struck key and the jam (ADR 0007), this module only carries them. Extension point: #224 adds `pressed`
 * (with its hold) and the finished keys from the same `lastKey` record.
 */

/**
 * The last key the engine took from you (#220), recorded by the store on every local keystroke it
 * applied: `key` as typed, `t` in ms since GO, `wrong` when the engine counted it as an error. #224 (the
 * press), #243 (the sound) and #241 (the stuck hint) read the same record.
 */
export type LastKey = { readonly key: string; readonly t: number; readonly wrong: boolean };

/** The `TypingMachine` props the store drives (`rows` and `skin` come from the seat). */
export type MachineProps = {
  /** The key down right now: always `null` until #224. */
  readonly pressed: string | null;
  /** The key just struck wrong, lower-cased to match `data-key` (`É` reads `é`); `null` otherwise. */
  readonly wrong: string | null;
  /** Block mode refused the last key: the typed view's jam. */
  readonly jammed: boolean;
  /** Your desk typed the whole text (#224 disables the keys). */
  readonly finished: boolean;
};

/**
 * The store fields the machine reads, declared structurally so this module stays free of the client
 * (#558 C10): the race store's `RaceState` fits it.
 */
export type MachineSource = {
  readonly lastKey: LastKey | null;
  readonly prediction: {
    readonly jammed: boolean;
    readonly state: { readonly status: string };
  } | null;
};

/** One cache entry per `lastKey` record (or none), one object per jam and finish combination. */
const cache = new WeakMap<object, MachineProps[]>();
const NO_KEY = {};

/**
 * The machine's props for a race state (#220 C2): `wrong` is the last key when the engine counted it as
 * an error (until the next key), `jammed` the prediction's jam (the typed view's). Memoised on the fields
 * it reads, so a snapshot that only moves a rival returns the same object and re-renders nothing, while
 * every keystroke (a new `lastKey`) returns a new one.
 */
export function selectMachineProps(state: MachineSource): MachineProps {
  const { lastKey, prediction } = state;
  const jammed = prediction?.jammed ?? false;
  const finished = prediction?.state.status === "finished";
  const ref = lastKey ?? NO_KEY;
  let entries = cache.get(ref);
  if (!entries) cache.set(ref, (entries = []));
  const slot = (jammed ? 2 : 0) + (finished ? 1 : 0);
  return (entries[slot] ??= {
    pressed: null,
    wrong: lastKey?.wrong ? lastKey.key.toLowerCase() : null,
    jammed,
    finished,
  });
}
