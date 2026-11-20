/**
 * Dead keys and composition (#1001 C3, ADR 0007 amendment, spec 14): the race input's events -> the
 * keystrokes the engine takes, one per committed NFC character, never a dead key. Zod-free and pure, so
 * the client input (`RaceInput`) runs it live and the tests replay the documented event sequences of
 * `work/log/1001.md` ("Documented event sequences", the fixtures in `./fixtures`) through it.
 *
 * Two event models, both handled (the log names which OS and browser documents which):
 * - **composition**: the dead key opens a composition (`compositionstart`, `compositionupdate` with the
 *   accent alone), the next key commits it (`compositionend` with `ê`). Everything during the composition
 *   is the IME's: keydowns carry `isComposing` (or `Process`/keyCode 229), its `beforeinput`/`input` are
 *   `insertCompositionText` (Input Events 1) or `deleteCompositionText`/`insertFromComposition` (Input
 *   Events 2). Only `compositionend.data` types; Backspace inside it edits the composition, never a key.
 * - **dead key without composition**: a `keydown` with `key === "Dead"` arms the layout's dead state,
 *   then the next key's inserted text (`beforeinput` `insertText`, else `input`) is what it typed (`ê`,
 *   or `^x` for a letter the accent does not combine with). The keydown after the dead key is not read:
 *   its `key` may be the base letter (`e`) while the text is `ê`. Backspace while armed cancels it.
 *
 * Outside both, a printable `keydown` types itself (the caller prevents its default, so no insert
 * follows; a replayed stream's insert for it is swallowed) and a keydown that names no key (`Unidentified`,
 * `Process`: virtual keyboards) leaves the typing to the insert that follows.
 */

/** The event types the race input listens to (ARCHITECTURE 7.3: a keystroke starts in the browser). */
export const KEY_EVENT_TYPES = [
  "keydown",
  "keyup",
  "beforeinput",
  "input",
  "compositionstart",
  "compositionupdate",
  "compositionend",
] as const;
export type KeyEventType = (typeof KEY_EVENT_TYPES)[number];

/** One input event as the composer reads it; a field the event type does not carry is `null`. */
export type KeyEventLike = {
  type: KeyEventType;
  /** `KeyboardEvent.key` (keydown, keyup). */
  key: string | null;
  /** `KeyboardEvent.code` (keydown, keyup). */
  code: string | null;
  /** `KeyboardEvent.isComposing` / `InputEvent.isComposing`. */
  isComposing: boolean | null;
  /** `InputEvent.data` / `CompositionEvent.data`. */
  data: string | null;
  /** `InputEvent.inputType` (beforeinput, input). */
  inputType: string | null;
  /** Modifiers of a keydown (absent: up). Shortcuts (Ctrl or Cmd without Alt) type nothing. */
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** `KeyboardEvent.keyCode`: 229 marks a key the IME is processing (MDN keydown). */
  keyCode?: number;
};

/** What one event did: the keystrokes it typed, and whether the caller must cancel its default. */
export type ComposeStep = { keys: string[]; preventDefault: boolean };

export type KeyComposer = {
  feed(event: KeyEventLike): ComposeStep;
  /** A composition or a dead key is under way: the next commit decides the keystroke. */
  readonly pending: boolean;
};

/**
 * The key a `keydown` types by itself, or `null` (#559 C4): `Backspace`, or one printable character as
 * the layout produced it (AltGr and Option included). Shortcuts (Ctrl or Cmd without Alt), named keys,
 * dead keys and keys inside a composition are not keystrokes.
 */
export function keyOf(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): string | null {
  if (e.isComposing) return null;
  if (e.key === "Backspace") return "Backspace";
  if (e.metaKey || (e.ctrlKey && !e.altKey)) return null;
  return Array.from(e.key).length === 1 ? e.key : null;
}

/** The committed text as keystrokes: NFC, one per code point (ADR 0007: one per committed character). */
export function committedKeys(data: string | null): string[] {
  return data ? Array.from(data.normalize("NFC")) : [];
}

const COMPOSITION_INPUTS = new Set([
  "insertCompositionText",
  "deleteCompositionText",
  "insertFromComposition",
]);
const isCompositionInput = (inputType: string | null) =>
  inputType !== null && COMPOSITION_INPUTS.has(inputType);

const NONE: ComposeStep = { keys: [], preventDefault: false };
const step = (keys: string[], preventDefault: boolean): ComposeStep => ({ keys, preventDefault });

export function createKeyComposer(): KeyComposer {
  /** Inside `compositionstart` .. `compositionend`. */
  let composing = false;
  /** A `Dead` keydown armed the layout; the next insert is its result. */
  let dead = false;
  /** The keydown after a dead key was seen: its insert (not its key) types. */
  let deadResolving = false;
  /** A keydown typed itself: the insert a replayed stream shows for it is the same key. */
  let insertTyped = false;
  /** The last `beforeinput` was read: its `input` twin is not read again. */
  let beforeInputRead = false;
  /** What the last composition committed: one stray keydown for it after `compositionend` is not a key. */
  let committed: string | null = null;

  const feed = (e: KeyEventLike): ComposeStep => {
    switch (e.type) {
      case "keyup":
        return NONE;
      case "compositionstart":
        composing = true;
        dead = false;
        deadResolving = false;
        committed = null;
        return NONE;
      case "compositionupdate":
        return NONE;
      case "compositionend": {
        composing = false;
        dead = false;
        deadResolving = false;
        insertTyped = false;
        const keys = committedKeys(e.data);
        committed = e.data ? e.data.normalize("NFC") : null;
        return step(keys, false);
      }
      case "keydown": {
        const key = e.key ?? "";
        beforeInputRead = false;
        insertTyped = false;
        const stray =
          committed !== null && (key === committed || key === "Process" || e.keyCode === 229);
        committed = null;
        if (composing || e.isComposing || key === "Process" || e.keyCode === 229 || stray) {
          return NONE;
        }
        if (key === "Dead") {
          dead = true;
          deadResolving = false;
          return NONE;
        }
        if (dead) {
          dead = false;
          // Backspace cancels the armed accent and types nothing (log: undocumented, assumed)
          if (key === "Backspace") return step([], true);
          // a modifier on its own keeps the accent armed (Shift for a capital)
          if (
            keyOf({ key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }) === null &&
            key !== "Unidentified"
          ) {
            dead = true;
            return NONE;
          }
          deadResolving = true;
          return NONE;
        }
        deadResolving = false;
        const typed = keyOf({
          key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          isComposing: false,
        });
        if (typed === null) return NONE;
        insertTyped = true;
        return step([typed], true);
      }
      case "beforeinput": {
        beforeInputRead = true;
        if (composing || isCompositionInput(e.inputType)) return NONE;
        if (insertTyped) {
          insertTyped = false;
          return step([], true);
        }
        if (e.inputType === "insertText" && e.data) {
          deadResolving = false;
          dead = false;
          return step(committedKeys(e.data), true);
        }
        if (e.inputType === "deleteContentBackward") {
          if (deadResolving) {
            deadResolving = false;
            return step([], true);
          }
          return step(["Backspace"], true);
        }
        return step([], true);
      }
      case "input": {
        const read = beforeInputRead;
        beforeInputRead = false;
        if (composing || e.isComposing || isCompositionInput(e.inputType)) return NONE;
        if (insertTyped) {
          insertTyped = false;
          return NONE;
        }
        if (read) return NONE;
        deadResolving = false;
        dead = false;
        return step(committedKeys(e.data), false);
      }
    }
  };

  return {
    feed,
    get pending() {
      return composing || dead || deadResolving;
    },
  };
}

/** The keystrokes a whole event sequence types (a fresh composer; the tests replay fixtures with it). */
export function composeKeys(events: readonly KeyEventLike[]): string[] {
  const composer = createKeyComposer();
  return events.flatMap((e) => composer.feed(e).keys);
}
