"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { REDUCED_MOTION_QUERY } from "@/components/ui";
import { useRaceStore } from "../../client/use-race-store";
import { selectMachineProps, type MachineProps } from "../../view/machine-props";
import type { MachineSkinId, MachineSkinProps } from "./skin";
import { TypingMachine } from "./typing-machine";

/** No key is disabled while you type. */
const NO_KEYS: readonly string[] = [];

/** The UI's fast duration (bible 8), read from the tokens: the press hold. */
const HOLD_TOKEN = "--motion-duration-fast";

/**
 * How long a pressed cap stays down, in ms: the `--motion-duration-fast` token as the machine's root
 * computes it (120ms; `0ms` under `prefers-reduced-motion` or `<html data-motion="reduce">`), and 0 under
 * any `data-motion="reduce"` ancestor (a scoped specimen). 0 means no press shows: no cap moves.
 */
function holdOf(root: HTMLElement | null): number {
  if (!root || root.closest('[data-motion="reduce"]')) return 0;
  const token = getComputedStyle(root).getPropertyValue(HOLD_TOKEN).trim();
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(token);
  return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : 0;
}

/**
 * The seat view's typing machine (#220, #224, bible 7.7a, 8): the skin seam `TypingMachine` driven by the
 * race store through one memoised selector, `selectMachineProps`, whose object changes once per keystroke.
 * It only sets attributes, and each skin's own CSS turns them into motion, so it draws every registered
 * skin and never imports one (the skin preference, #638, only changes `skin`):
 * - `pressed`: the struck key, held down for the `--motion-duration-fast` token, then released; never
 *   under reduced motion (the token is `0ms`), so no cap moves there;
 * - `wrong`: the key the engine counted as an error, until the next key; a second wrong press of the same
 *   key drops it for one frame, so the skin's wrong-key animation starts again;
 * - `jammed`: the Block-mode jam, as the view has it;
 * - `disabledKeys`: every key of `rows` and the space bar once your desk is finished (nothing pressed or
 *   struck then).
 * The server renders the before-start machine (the store's server snapshot); each keystroke re-renders it.
 */
export function TypingMachineLive({
  rows,
  skin,
}: Pick<MachineSkinProps, "rows"> & { skin?: MachineSkinId }) {
  const props = useRaceStore(selectMachineProps);
  const { pressed, wrong, jammed, finished } = props;
  const root = useRef<HTMLDivElement>(null);

  // The press: shown from the keystroke until its hold ends (`released` names the keystroke let go). The
  // hold is read from the root on mount and again whenever the motion setting changes (the media query or
  // `<html data-motion>`, which the settings screen #66 sets mid-session), letting go of the key down then;
  // `null` until the first read, as in a static render. With no hold (reduced motion) no press shows.
  const [holdMs, setHoldMs] = useState<number | null>(null);
  const [released, setReleased] = useState<MachineProps | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useLayoutEffect(() => {
    const read = () => {
      setHoldMs(holdOf(root.current));
      setReleased(latest.current);
    };
    read();
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    media.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (pressed === null || !holdMs) return;
    const timer = setTimeout(() => setReleased(props), holdMs);
    return () => clearTimeout(timer);
  }, [props, pressed, holdMs]);
  const motion = holdMs !== 0;

  // The replay: a new keystroke striking the same key wrong again drops `wrong` for one frame (CSS cannot
  // restart an animation on an attribute that never changed). Adjusted during render, so the attribute
  // leaves the DOM in the very commit of that keystroke.
  const [cue, setCue] = useState({ props, replay: false });
  if (cue.props !== props) {
    setCue({ props, replay: motion && wrong !== null && cue.props.wrong === wrong });
  }
  useEffect(() => {
    if (!cue.replay) return;
    // two frames: the first paints the cap without `wrong`, the second puts it back
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        setCue((c) => (c === cue ? { props: c.props, replay: false } : c)),
      );
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [cue]);

  const disabledKeys = useMemo(
    () => (finished ? [...rows.flat(), " "] : NO_KEYS),
    [finished, rows],
  );

  return (
    <TypingMachine
      ref={root}
      rows={rows}
      skin={skin}
      pressed={!finished && motion && released !== props ? pressed : null}
      wrong={finished || cue.replay ? null : wrong}
      jammed={jammed}
      disabledKeys={disabledKeys}
    />
  );
}
