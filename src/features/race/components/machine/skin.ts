import type { ReactElement } from "react";

/**
 * The machine skin seam (#558, bible 7.7a): the ids, the props every skin takes and the key attributes
 * every skin sets. Types and pure data only: the registry (`skins/index.ts`) and the skins import this
 * module, never the other way round (a type-only cycle would still fail `no-circular`).
 */

/** Every registered skin id; a preference (#638) parses against this list. */
export const machineSkinIds = ["teleprinter"] as const;
export type MachineSkinId = (typeof machineSkinIds)[number];

/** What a skin draws from: the same props for every skin (the `TypingMachine` props without `skin`). */
export type MachineSkinProps = {
  /** The keys, row by row from the back (the number row) to the front; a layout is just data (#224). */
  rows: readonly (readonly string[])[];
  /** The key down right now (`" "` is the space bar). */
  pressed?: string | null;
  /** The key just struck wrong: that one cap reads red. */
  wrong?: string | null;
  /** Block mode refused a key: the machine jams. */
  jammed?: boolean;
  /** Keys that do nothing right now. */
  disabledKeys?: readonly string[];
};

/** One machine look: its id and the component that draws it inside the frame's root. */
export type MachineSkin<Id extends string = MachineSkinId> = {
  id: Id;
  Machine: (props: MachineSkinProps) => ReactElement;
};

/**
 * The attributes of one key, the same in every skin and driven only by props (C4): a presentational
 * span named by `data-key`, with `data-pressed`, `data-wrong` and `data-disabled` present only when on.
 */
export function keyAttributes(
  key: string,
  { pressed, wrong, disabledKeys }: Omit<MachineSkinProps, "rows" | "jammed">,
) {
  return {
    role: "presentation",
    "data-key": key,
    "data-pressed": key === pressed ? "true" : undefined,
    "data-wrong": key === wrong ? "true" : undefined,
    "data-disabled": disabledKeys?.includes(key) ? "true" : undefined,
  } as const;
}
