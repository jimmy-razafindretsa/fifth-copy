"use client";

import { useId, useState } from "react";
import { fill } from "@/i18n/format";
import { toggleLine, YOU_LINE, type GraphMark } from "../view/series";
import { GraphPlot, LineToggle, type DrawnLine } from "./race-graph-plot";

export type RaceGraphLinesProps = {
  yMax: number;
  endMs: number;
  marks: GraphMark[];
  lines: DrawnLine[];
  /** The lines drawn first (`defaultLines`). */
  initial: string[];
  /** The viewer's own stored points (`data-points`, as the single-line graph), or null. */
  ownPoints: number | null;
  bonusNames: Record<string, string>;
  /** The image's name while the viewer's own line is shown (`graphName`). */
  ownName: string;
  /** The image's name otherwise (`{n}` lines shown). */
  othersName: { one: string; other: string };
  legend: string;
  simulated: string;
};

/**
 * The graph with other lines (#999 C52), the client leaf: it holds which lines are shown and draws the
 * plot and the toggle from props (everything else was computed on the server). The server render already
 * draws `initial`, so the graph reads without JavaScript.
 */
export function RaceGraphLines(props: RaceGraphLinesProps) {
  const [shown, setShown] = useState(props.initial);
  const idPrefix = useId();
  const order = props.lines.map((l) => l.id);
  const name = shown.includes(YOU_LINE)
    ? props.ownName
    : fill(shown.length === 1 ? props.othersName.one : props.othersName.other, {
        n: shown.length,
      });
  return (
    <>
      <GraphPlot
        yMax={props.yMax}
        endMs={props.endMs}
        marks={props.marks}
        lines={props.lines}
        shown={shown}
        bonusNames={props.bonusNames}
        name={name}
        ownPoints={props.ownPoints}
      />
      <LineToggle
        legend={props.legend}
        simulated={props.simulated}
        lines={props.lines}
        shown={shown}
        idPrefix={idPrefix}
        onToggle={(id, checked) => setShown((s) => toggleLine(s, id, checked, order))}
      />
    </>
  );
}
