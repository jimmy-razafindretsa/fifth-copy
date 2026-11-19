import type { CSSProperties } from "react";
import { fill } from "@/i18n/format";
import type { Heatmap, HeatKey } from "../view/heatmap";
import type { PersonalLabels } from "../view/report-labels";
import { keyName } from "./coaching";
import styles from "./report-heatmap.module.css";

export type ReportHeatmapProps = {
  map: Heatmap;
  /** The layout drawn (identity's id: `CSA`, `US_QWERTY`…): its settings name goes in the sentence. */
  layout: string;
  labels: PersonalLabels;
};

/** The board's one sentence: the missed keys on it, most missed first, or no error. */
export function heatmapName(map: Heatmap, layout: string, labels: PersonalLabels): string {
  const h = labels.heatmap;
  const name = h.layouts[layout] ?? layout;
  if (map.missed.length === 0) return fill(h.clean, { layout: name });
  const keys = map.missed
    .map((k) => fill(h.key, { key: k.char === " " ? keyName(k.char, labels) : k.cap, n: k.errors }))
    .join(", ");
  return fill(h.board, { layout: name, keys });
}

/**
 * The compact keyboard heatmap (#999 C54, spec 11.3, bible 14.3 "keyboard heatmap paper -> gold -> red",
 * 14.4 "Keyboard heatmap"), a section of the personal card under the errors by key, presentational: the
 * viewer's own keys of this race on their layout (four rows and the space bar, the keyboard map's pads
 * and unit, #324), each key a paper square in an ink rule with its cap; a missed key's lower band runs
 * from gold (one error) to red (the race's most missed key); a key the text never asked for is
 * newsprint. The board is one image named by one sentence (the missed keys and their counts), so colour
 * is never the only cue; the legend under it reads the scale. No motion.
 */
export function ReportHeatmap({ map, layout, labels }: ReportHeatmapProps) {
  const width = (units: number) => `calc(${(units * map.unit).toFixed(2)}% - 3px)`;
  return (
    <div className={styles.section} data-section="heatmap" data-layout={layout}>
      <h3 className={styles.title}>{labels.heatmap.title}</h3>
      <div
        className={styles.board}
        role="img"
        aria-label={heatmapName(map, layout, labels)}
        style={{ "--key": width(1) } as CSSProperties}
      >
        {map.rows.map((row) => (
          <div key={row.id} className={styles.row} data-row={row.id}>
            {row.pad > 0 && <span className={styles.pad} style={{ width: width(row.pad) }} />}
            {row.keys.map((k) => (
              <Key key={k.char} k={k} />
            ))}
          </div>
        ))}
        <div className={styles.row} data-row="space">
          <span className={styles.pad} style={{ width: width(3.5) }} />
          <Key k={map.space} wide={width(7)} />
        </div>
      </div>
      <p className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} data-swatch="clean" />
          {labels.heatmap.legendClean}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatch} data-swatch="heat" />
          {labels.heatmap.legendHeat}
        </span>
      </p>
    </div>
  );
}

function Key({ k, wide }: { k: HeatKey; wide?: string }) {
  const style = { "--heat": k.heat, ...(wide ? { width: wide } : {}) } as CSSProperties;
  return (
    <span
      className={wide ? `${styles.key} ${styles.space}` : styles.key}
      style={style}
      data-key={k.char}
      data-state={k.state}
      data-errors={k.errors}
    >
      {!wide && <span className={styles.cap}>{k.cap}</span>}
      {k.state === "missed" && <span className={styles.heat} />}
    </span>
  );
}
