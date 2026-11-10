import type { AudioEngine } from "./engine";

/**
 * The store fields the sounds read (#243 C3), declared structurally so this module stays free of the
 * store (the race store's `RaceState` fits it). Nothing here re-derives a race rule (ADR 0007): the
 * engine's prediction decided the key and the jam, the server the stamps.
 */
export type SoundSource = {
  readonly phase: string;
  readonly lastKey: object | null;
  readonly prediction: { readonly jammed: boolean } | null;
  readonly stamps: readonly { readonly id: number }[];
};

type Store = { getState(): SoundSource; subscribe(listener: () => void): () => void };

/**
 * Plays the race's sounds from the store (#243 C3): one plain subscription, no React render involved.
 * A new `lastKey` (your keystroke the engine took) clacks, or plays `jam` when Block refused it (the
 * prediction is jammed after it); the GO (countdown to running) and every stamp that shows (a new visible
 * stamp id: overtake, passed, your finish) slam `stamp`. Returns the unsubscribe.
 */
export function bindSounds(store: Store, engine: Pick<AudioEngine, "play">): () => void {
  let prev = store.getState();
  return store.subscribe(() => {
    const next = store.getState();
    const was = prev;
    prev = next;
    if (next.lastKey !== was.lastKey && next.lastKey !== null) {
      engine.play(next.prediction?.jammed ? "jam" : "clack");
    }
    const shown = next.stamps[0]?.id;
    const go = was.phase === "countdown" && next.phase === "running";
    if (go || (shown !== undefined && shown !== was.stamps[0]?.id)) engine.play("stamp");
  });
}
