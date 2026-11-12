import { createAudioEngine } from "./engine";
import { bindSounds, type SoundSource } from "./hooks";

/** What the sound toggle holds once the audio module loaded. */
export type SoundController = { setMuted(muted: boolean): void; dispose(): void };

type Store = { getState(): SoundSource; subscribe(listener: () => void): () => void };

/**
 * The audio module's entry (#243 C4, ADR 0013): `SoundToggle` `import()`s this file on the first unmute,
 * so the engine, the bindings and the sound files stay out of the race route's first load. It opens one
 * `AudioContext` (from the toggle's click: a user gesture), loads the set and binds the store.
 */
export function startSounds(store: Store): SoundController {
  const ctx = new AudioContext();
  const engine = createAudioEngine(() => ctx);
  void engine.load();
  const off = bindSounds(store, engine);
  return {
    setMuted: (muted) => engine.setMuted(muted),
    dispose() {
      off();
      void ctx.close().catch(() => undefined);
    },
  };
}
