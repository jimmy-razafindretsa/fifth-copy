"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import styles from "./race-input.module.css";

/** The typing surface (bible 7.7a): the telex strip, the typed sheet and the machine. */
export const TYPING_SURFACE = "[data-telex], [data-sheet], [data-machine]";

/** The fields of a `keydown` this input reads. */
export type KeydownLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey"> & {
  isComposing?: boolean;
};

/**
 * The key a `keydown` types, or `null` for anything else (#559 C4): `Backspace`, or one printable
 * character as the layout produced it (`e.key`, AltGr and Option combinations included). Shortcuts
 * (Ctrl or Cmd without Alt), named keys (Shift, Enter, Tab, arrows), dead keys and composition are not
 * keystrokes.
 */
export function keyOf(e: KeydownLike): string | null {
  if (e.isComposing) return null;
  if (e.key === "Backspace") return "Backspace";
  if (e.metaKey || (e.ctrlKey && !e.altKey)) return null;
  return Array.from(e.key).length === 1 ? e.key : null;
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
};

/**
 * The race's key capture (#559 C4, bible 7.7: an invisible input takes the typing, paste is disabled in
 * races; ARCHITECTURE 7.7: the client half of the anti-cheat). A visually hidden `<input>` with every
 * browser aid off (autocomplete, autocorrect, autocapitalize, spellcheck); focused at GO and on any press
 * inside the typing surface. Printable characters and `Backspace` reach `onKey`, from `keydown` or, where
 * a virtual keyboard sends no key (`Unidentified`), from `beforeinput`; nothing is ever written into the
 * field. Paste, drop, and copying from the surface give nothing. Presentational: the seat view hands it
 * the lock and the key sink (the store, the engine and the socket stay out of components), and the live
 * error settings and errors it carries as data for tests and later cards (#220 C6).
 */
export function RaceInput({ disabled, onKey, label, mode, backspace, errors }: RaceInputProps) {
  const input = useRef<HTMLInputElement>(null);
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
    // the virtual keyboards that send `Unidentified` keydowns type through here
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType.startsWith("insertComposition")) return; // dead keys and IMEs: #567
      e.preventDefault();
      if (e.inputType === "insertText" && e.data) for (const ch of e.data) sink.current(ch);
      else if (e.inputType === "deleteContentBackward") sink.current("Backspace");
    };
    const clear = () => {
      el.value = "";
    };
    // text that reached the field anyway (an insert with no cancelable beforeinput) is typed, then cleared
    const onInput = (e: Event) => {
      if ((e as InputEvent).isComposing) return;
      const typed = el.value;
      el.value = "";
      for (const ch of typed) sink.current(ch);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("dragstart", refuse);
    document.addEventListener("drop", refuse);
    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("paste", refuse);
    el.addEventListener("compositionend", clear);
    el.addEventListener("input", onInput);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("dragstart", refuse);
      document.removeEventListener("drop", refuse);
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("paste", refuse);
      el.removeEventListener("compositionend", clear);
      el.removeEventListener("input", onInput);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const key = keyOf({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      isComposing: e.nativeEvent.isComposing,
    });
    if (key === null) return;
    e.preventDefault();
    onKey(key);
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
