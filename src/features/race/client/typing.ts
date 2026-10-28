import { keystrokeSchema, MAX_RACE_MS } from "@fifth-copy/protocol";
import { createKeyBatcher, type KeyBatcher } from "./key-batcher";
import type { Keystroke } from "./prediction";
import { selectCanType, type RaceStore, type RaceTimer } from "./store";

const deviceTimer: RaceTimer = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type Typing = {
  /** One key from the input (a printable character or `Backspace`). */
  press(key: string): void;
  /** Sends what is queued and stops (the seat view disconnects). */
  dispose(): void;
};

export type TypingOptions = {
  store: Pick<RaceStore, "getState" | "dispatch">;
  /** `RoomSocket.sendKeys`. */
  send: (batch: Keystroke[]) => void;
  timer?: RaceTimer;
  flushMs?: number;
};

/**
 * The seat view's keystroke path (#559, ARCHITECTURE 7.3): a key from `RaceInput` is stamped with its
 * `t` (ms since GO on the corrected clock, never going back), applied at once through the store's
 * prediction, and queued for the race server in <= 50 ms batches. Locked before GO and while your own
 * desk is not typing (`selectCanType`); the finishing key leaves at once, and a snapshot that brings
 * the desk back to typing (the server never got that key, #645) opens it again. A key the wire would
 * refuse (`keystrokeSchema`) is never applied, so every applied key is sent. Each batch sent is told
 * to the store (`sent`), which bounds what a snapshot can acknowledge.
 */
export function createTyping({ store, send, timer = deviceTimer, flushMs }: TypingOptions): Typing {
  const elapsed = () => {
    const { race, clockOffset } = store.getState();
    return race ? timer.now() + clockOffset - race.t0 : -Infinity;
  };
  const batcher: KeyBatcher = createKeyBatcher(
    (batch) => {
      send(batch);
      store.dispatch({ type: "sent", count: batch.length });
    },
    { flushMs, now: elapsed, timer },
  );

  return {
    press(key) {
      const state = store.getState();
      const before = state.prediction;
      const now = elapsed();
      if (!selectCanType(state) || !before || now < 0) return;
      const t = Math.min(MAX_RACE_MS, Math.max(Math.round(now), before.state.lastT));
      const keystroke = { t, key };
      // the prediction only takes what the server can be told (#645 C4)
      if (!keystrokeSchema.safeParse(keystroke).success) return;
      store.dispatch({ type: "key", keystroke });
      const after = store.getState().prediction;
      // the engine refused it (the store kept the same prediction): nothing to tell the server
      if (!after || after === before) return;
      batcher.push(keystroke);
      // the finish leaves at once; the gate above, not a closed batcher, stops later keys (#645 C3)
      if (after.state.status !== "typing") batcher.flush();
    },
    dispose: () => batcher.close(),
  };
}
