"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  createKeyComposer,
  keyOf,
  type KeyComposer,
  type KeyEventLike,
} from "../client/input/compose-keys";
import styles from "./race-input.module.css";

/** The typing surface (bible 7.7a): the telex strip, the typed sheet and the machine. */
export const TYPING_SURFACE = "[data-telex], [data-sheet], [data-machine]";

/** The fields of a `keydown` this input reads. */
export type KeydownLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey"> & {
  isComposing?: boolean;
  shiftKey?: boolean;
  /** The physical key (`KeyK`): the play shortcut is matched on it (#951). */
  code?: string;
  keyCode?: number;
};

/** The key a `keydown` types by itself (#559 C4); dead keys and composition: `composeKeys` (#1001). */
export { keyOf };

/**
 * One DOM event through the composer (#1001 C4): its keystrokes go to `onKey` (one per committed NFC
 * character), and the return says whether the caller cancels the event's default. During a composition
 * or a pending dead key nothing reaches `onKey`, so the prediction, the strip and the machine (no
 * `data-wrong`) do not move until the character is committed.
 */
export function routeInputEvent(
  composer: KeyComposer,
  event: KeyEventLike,
  onKey: (key: string) => void,
): boolean {
  const { keys, preventDefault } = composer.feed(event);
  for (const key of keys) onKey(key);
  return preventDefault;
}

const EMPTY = { key: null, code: null, isComposing: null, data: null, inputType: null } as const;

/**
 * The play shortcut (#951, was a bare Enter in #236): Option (macOS) or Alt (Windows, Linux) plus this
 * card's letter (`playKey`, a new one per card), matched on the physical key (`code`), so Option's
 * special characters and AltGr (Ctrl+Alt) never count. It types nothing: the caller stops the event.
 */
export function isPlayKey(e: KeydownLike, playKey: string | null): boolean {
  return (
    playKey !== null &&
    e.code === `Key${playKey}` &&
    e.altKey &&
    !e.isComposing &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey
  );
}

const inSurface = (node: Node | null | undefined) => {
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.closest(TYPING_SURFACE);
};

export type RaceInputProps = {
  /** Locked before GO and after your finish: the input takes no key and no focus. */
  disabled: boolean;
  /** One key: a printable character or `Backspace`. */
  onKey: (key: string) => void;
  /** Its accessible name (the strip's: the glyphs are hidden from assistive tech). */
  label: string;
  /** The host's error mode (#220), as `data-mode`; absent until the room's settings arrive. */
  mode?: "continue" | "block";
  /** Backspace allowed this race (#220), as `data-backspace="on" | "off"`. */
  backspace?: boolean;
  /** Your desk's errors as the engine counted them (#220), as `data-errors`; absent without a desk. */
  errors?: number;
  /** The play shortcut (#951, `isPlayKey`): play your Sabotage card. Absent: no shortcut. */
  onPlay?: () => void;
  /** This card's letter (`PLAY_KEYS`), with Option/Alt; `null` without a card. */
  playKey?: string | null;
};

/**
 * The race's key capture (#559 C4, bible 7.7: an invisible input takes the typing, paste is disabled in
 * races; ARCHITECTURE 7.7: the client half of the anti-cheat). A visually hidden `<input>` with every
 * browser aid off (autocomplete, autocorrect, autocapitalize, spellcheck); focused at GO and on any press
 * inside the typing surface. Every keydown, insert and composition event goes through one `composeKeys`
 * composer (#1001): printable characters and `Backspace` reach `onKey` from `keydown`, from `beforeinput`
 * where a virtual keyboard sends no key (`Unidentified`) or after a dead key, and from `compositionend`
 * for an IME or macOS dead key, one keystroke per committed NFC character; a dead key alone or a key
 * inside a composition types nothing. Nothing stays in the field. Paste, drop, and copying from the surface give nothing. Presentational: the seat view hands it
 * the lock and the key sink (the store, the engine and the socket stay out of components), and the live
 * error settings and errors it carries as data for tests and later cards (#220 C6). A bare Enter plays the
 * Sabotage card (#236, `onPlay`); Space and every printable key stay keystrokes.
 */
export function RaceInput({
  disabled,
  onKey,
  label,
  mode,
  backspace,
  errors,
  onPlay,
  playKey = null,
}: RaceInputProps) {
  const input = useRef<HTMLInputElement>(null);
  // one composer per input (#1001): a dead key or a composition spans several events
  const [composer] = useState(createKeyComposer);
  const sink = useRef(onKey);
  useEffect(() => {
    sink.current = onKey;
  }, [onKey]);

  // GO (or a page that loads mid-race): the keys go here at once
  useEffect(() => {
    if (!disabled) input.current?.focus({ preventScroll: true });
  }, [disabled]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const focus = () => el.focus({ preventScroll: true });
    // a press on the strip, the sheet or the machine types here; no selection starts on the surface
    const onDown = (e: MouseEvent) => {
      if (!inSurface(e.target as Node)) return;
      e.preventDefault();
      focus();
    };
    // the text never leaves through the clipboard
    const onCopy = (e: ClipboardEvent) => {
      const selection = document.getSelection();
      const target = e.target as Node | null;
      if (
        target !== el &&
        !inSurface(target) &&
        !inSurface(selection?.anchorNode) &&
        !inSurface(selection?.focusNode)
      ) {
        return;
      }
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "");
    };
    const refuse = (e: Event) => {
      if (e.target === el || inSurface(e.target as Node)) e.preventDefault();
    };
    const route = (event: KeyEventLike) =>
      routeInputEvent(composer, event, (key) => sink.current(key));
    // inserts: virtual keyboards (`Unidentified` keydowns) and the letter after a dead key type here;
    // a composition's inserts are the IME's, left alone (#1001)
    const onBeforeInput = (e: InputEvent) => {
      const cancel = route({
        ...EMPTY,
        type: "beforeinput",
        inputType: e.inputType,
        data: e.data,
        isComposing: e.isComposing,
      });
      if (cancel) e.preventDefault();
    };
    // text that reached the field anyway (an insert with no cancelable beforeinput) is typed, then cleared
    const onInput = (e: Event) => {
      const event = e as InputEvent;
      const composing = event.isComposing === true;
      route({
        ...EMPTY,
        type: "input",
        inputType: event.inputType ?? "insertText",
        data: el.value,
        isComposing: composing,
      });
      if (!composing) el.value = "";
    };
    const onComposition = (e: CompositionEvent) => {
      const type = e.type as "compositionstart" | "compositionupdate" | "compositionend";
      route({ ...EMPTY, type, data: e.data });
      if (type === "compositionend") el.value = "";
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("dragstart", refuse);
    document.addEventListener("drop", refuse);
    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("paste", refuse);
    el.addEventListener("compositionstart", onComposition);
    el.addEventListener("compositionupdate", onComposition);
    el.addEventListener("compositionend", onComposition);
    el.addEventListener("input", onInput);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("dragstart", refuse);
      document.removeEventListener("drop", refuse);
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("paste", refuse);
      el.removeEventListener("compositionstart", onComposition);
      el.removeEventListener("compositionupdate", onComposition);
      el.removeEventListener("compositionend", onComposition);
      el.removeEventListener("input", onInput);
    };
  }, [composer]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const like: KeydownLike = {
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing,
      code: e.code,
    };
    if (onPlay && isPlayKey(like, playKey)) {
      e.preventDefault();
      onPlay();
      return;
    }
    const cancel = routeInputEvent(
      composer,
      {
        ...EMPTY,
        type: "keydown",
        key: e.key,
        code: e.code,
        isComposing: e.nativeEvent.isComposing,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        keyCode: e.keyCode,
      },
      onKey,
    );
    if (cancel) e.preventDefault();
  };

  return (
    <input
      ref={input}
      type="text"
      data-race-input
      className={styles.input}
      aria-label={label}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      inputMode="text"
      data-mode={mode}
      data-backspace={backspace === undefined ? undefined : backspace ? "on" : "off"}
      data-errors={errors}
      disabled={disabled}
      onKeyDown={onKeyDown}
    />
  );
}
