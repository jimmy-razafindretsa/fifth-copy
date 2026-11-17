import type { KeyFile, KeyFileEntry } from "./key-file";
import { KEY_SCALE } from "./key-sheet";

/**
 * The key inventory of the Personnel file (#964, bible 14.3, reference `Profil.dc.html` section
 * `INVENTAIRE DES TOUCHES`, its `invRows`): pure bar geometry over `KeyFile.keys` of #961. Four rows of
 * one bar per reference key, in the key file's order; a key never met (`state: "none"`) has no bar in
 * any row, as the reference draws it.
 *
 * Extension point: a row is data (`INVENTORY_ROWS`: id, height, value, scale, look), so a fifth row is
 * one more entry; the component draws whatever `inventoryRows` returns.
 */

/** How a bar is painted: `good` / `weak` against the goal, else the row's own tone. */
export type BarLook = "good" | "weak" | "ink" | "red" | "muted";

export type InventoryRowId = "speed" | "strokes" | "errors" | "ratio";

export type InventoryRowSpec = {
  id: InventoryRowId;
  /** The row's height in px (the reference's `h`). */
  height: number;
  /** The figure a bar stands for; `null` draws no bar. */
  value: (key: KeyFileEntry) => number | null;
  /** `fixed`: 0 to `KEY_SCALE.high` WPM with the goal line; `relative`: the row's largest value is 100 %. */
  scale: "fixed" | "relative";
  look: (key: KeyFileEntry) => BarLook;
};

/** The reference's four rows, top to bottom. */
export const INVENTORY_ROWS: readonly InventoryRowSpec[] = [
  {
    id: "speed",
    height: 150,
    value: (k) => k.averageWpm,
    scale: "fixed",
    look: (k) => (k.state === "good" ? "good" : "weak"),
  },
  { id: "strokes", height: 80, value: (k) => k.hits, scale: "relative", look: () => "ink" },
  { id: "errors", height: 80, value: (k) => k.errors, scale: "relative", look: () => "red" },
  { id: "ratio", height: 80, value: (k) => k.errorRate, scale: "relative", look: () => "muted" },
];

export type InventoryBar = {
  char: string;
  /** Percent of the row's height, one decimal; `null`: no bar (a key never met). */
  height: number | null;
  look: BarLook;
};

export type InventoryRow = {
  id: InventoryRowId;
  height: number;
  /** Percent of the row's height where the dashed goal line sits; `null` on a row without one. */
  goalAt: number | null;
  bars: InventoryBar[];
};

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** A share of the row as a percent, at most 100, one decimal; 0 when the row has nothing to scale by. */
const share = (value: number, top: number) =>
  top > 0 ? oneDecimal(Math.min(1, value / top) * 100) : 0;

/** The four rows of a key file (#964 C2): heights in percent, the goal line on the speed row. */
export function inventoryRows(
  keyFile: Pick<KeyFile, "keys" | "goal">,
  rows: readonly InventoryRowSpec[] = INVENTORY_ROWS,
): InventoryRow[] {
  const met = keyFile.keys.filter((k) => k.state !== "none");
  return rows.map((row) => {
    const top =
      row.scale === "fixed" ? KEY_SCALE.high : Math.max(0, ...met.map((k) => row.value(k) ?? 0));
    return {
      id: row.id,
      height: row.height,
      goalAt: row.scale === "fixed" ? share(keyFile.goal, KEY_SCALE.high) : null,
      bars: keyFile.keys.map((k) => {
        const value = k.state === "none" ? null : row.value(k);
        return {
          char: k.char,
          height: value === null ? null : share(value, top),
          look: row.look(k),
        };
      }),
    };
  });
}
