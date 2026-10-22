"use client";

import { useRaceStore } from "../../client/use-race-store";
import { selectMachineProps } from "../../view/machine-props";
import type { MachineSkinId, MachineSkinProps } from "./skin";
import { TypingMachine } from "./typing-machine";

/** No key is disabled while you type (#224 disables them once you finish). */
const NO_KEYS: readonly string[] = [];

/**
 * The seat view's typing machine (#220, bible 7.7a): the skin seam `TypingMachine` driven by the race
 * store through one memoised selector, `selectMachineProps` (the struck key, the jam). It never imports a
 * skin module, so it draws every registered skin; the skin preference (#638) only changes `skin`. The
 * server renders the before-start machine (the store's server snapshot); each keystroke re-renders it.
 */
export function TypingMachineLive({
  rows,
  skin,
}: Pick<MachineSkinProps, "rows"> & { skin?: MachineSkinId }) {
  const { pressed, wrong, jammed } = useRaceStore(selectMachineProps);
  return (
    <TypingMachine
      rows={rows}
      skin={skin}
      pressed={pressed}
      wrong={wrong}
      jammed={jammed}
      disabledKeys={NO_KEYS}
    />
  );
}
