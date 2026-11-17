"use client";

import { useState } from "react";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import type { KeyFileEntry, KeyState } from "../view/key-file";
import { keySheetPlot, keySpan } from "../view/key-sheet";
import { GRID_LINES, PLOT } from "../view/performance-curve";
import { BLANK_FIGURE, NBSP, oneDecimal } from "../view/profile-figures";
import styles from "./key-sheet.module.css";

export type KeySheetLabels = Messages["profile"]["keySheet"];

/** What the leaf draws of a key: the entry without its hit counts. */
export type KeySheetKey = Pick<
  KeyFileEntry,
  | "char"
  | "state"
  | "series"
  | "latestWpm"
  | "bestWpm"
  | "averageWpm"
  | "learningRate"
  | "errorRate"
>;

export type KeySheetProps = {
  /** The 30 reference keys, in the key file's order. */
  keys: KeySheetKey[];
  /** The key the server render selects (`initialKey`). */
  initial: string;
  goal: number;
  labels: KeySheetLabels;
  locale: Locale;
};

/** The key as its cap reads, upper case in the locale (`é` -> `É`). */
export const capOf = (char: string, locale: Locale) => char.toLocaleUpperCase(locale);

/** `+0,38 / JOUR` / `+0.38 / DAY`: signed, two decimals; `INCERTAIN` / `UNCERTAIN` without a rate. */
export function rateText(rate: number | null, labels: KeySheetLabels, locale: Locale): string {
  if (rate === null) return labels.uncertain;
  const rounded = Math.round(rate * 100) / 100 || 0;
  const shown = new Intl.NumberFormat(`${locale}-CA`, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(rounded);
  return fill(labels.perDay, { rate: shown });
}

/** The five 7.4 cells of a key: label and shown value (`41,3 MPM`, `4,2 %`, `—`). */
export function keyCells(key: KeySheetKey, labels: KeySheetLabels, locale: Locale) {
  const wpm = (v: number | null) =>
    v === null ? BLANK_FIGURE : `${oneDecimal(v, locale)}${NBSP}${labels.wpm}`;
  return [
    { id: "latest", label: labels.cells.latest, value: wpm(key.latestWpm) },
    { id: "best", label: labels.cells.best, value: wpm(key.bestWpm) },
    { id: "average", label: labels.cells.average, value: wpm(key.averageWpm) },
    { id: "rate", label: labels.cells.rate, value: rateText(key.learningRate, labels, locale) },
    {
      id: "errors",
      label: labels.cells.errors,
      value:
        key.errorRate === null
          ? BLANK_FIGURE
          : `${oneDecimal(key.errorRate * 100, locale)}${NBSP}%`,
    },
  ] as const;
}

/**
 * The plot's one sentence: `Touche E : de 28,0 à 41,3 MPM sur 40 jours, objectif de 35 MPM atteint.`
 * (the first and latest day values, the days with a value; `reached` from the key's average).
 */
export function plotSentence(
  key: KeySheetKey,
  goal: number,
  labels: KeySheetLabels,
  locale: Locale,
): string {
  const cap = capOf(key.char, locale);
  const { from, to, count } = keySpan(key);
  if (from === null || to === null) return fill(labels.plotNone, { key: cap });
  const reached = fill(key.state === "good" ? labels.reached : labels.notReached, { goal });
  const values = {
    key: cap,
    from: oneDecimal(from, locale),
    to: oneDecimal(to, locale),
    count,
    goal: reached,
  };
  return fill(count === 1 ? labels.plotOne : labels.plot, values);
}

/**
 * The key sheet's frame (#963, bible 14.3, `Profil.dc.html` `INTERROGATOIRE INDIVIDUEL`): the chip row,
 * the five 7.4 cells, the plot (fixed 0-60 scale, one inline SVG, ADR 0013) and its legend. The one
 * client leaf of the section: it holds the selected key and draws it from props, fetching nothing; the
 * server render already draws `initial`, so the sheet reads without JavaScript. A pick is announced
 * through a polite live region (empty until the first pick).
 */
export function KeySheet({ keys, initial, goal, labels, locale }: KeySheetProps) {
  const [selected, setSelected] = useState(initial);
  const [announced, setAnnounced] = useState("");
  const key = keys.find((k) => k.char === selected) ?? keys[0]!;
  const sentence = plotSentence(key, goal, labels, locale);
  const plot = keySheetPlot(key, goal);
  const cap = capOf(key.char, locale);

  const pick = (char: string) => {
    const next = keys.find((k) => k.char === char);
    if (!next || next.state === "none") return;
    setSelected(char);
    setAnnounced(plotSentence(next, goal, labels, locale));
  };

  return (
    <div className={styles.frame} data-key-sheet="" data-key-selected={key.char}>
      <KeyChips keys={keys} selected={key.char} onPick={pick} labels={labels} locale={locale} />

      <dl className={styles.cells}>
        {keyCells(key, labels, locale).map((cell) => (
          <div key={cell.id} className={styles.cell} data-key-stat={cell.id}>
            <dt className={styles.cellLabel}>{cell.label}</dt>
            <dd className={styles.cellValue}>{cell.value}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.plotRow}>
        <div className={styles.ticks} aria-hidden="true">
          {[60, 45, 30, 15, 0].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className={styles.plot}>
          <svg
            viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
            role="img"
            aria-label={sentence}
            className={styles.svg}
            data-key-plot=""
          >
            <g className={styles.grid}>
              {GRID_LINES.map((y) => (
                <line key={y} x1={0} x2={PLOT.width} y1={y} y2={y} />
              ))}
            </g>
            <path d={plot.goal} className={styles.goal} data-key-line="goal" />
            <path d={plot.dots} className={styles.dots} data-key-line="dots" />
            {plot.line ? (
              <path d={plot.line} className={styles.line} data-key-line="speed" />
            ) : null}
          </svg>
        </div>
      </div>

      <ul className={styles.legend} data-key-legend="">
        <li>
          <i className={styles.speedSwatch} aria-hidden="true" />
          {fill(labels.legendSpeed, { key: cap })}
        </li>
        <li>
          <i className={styles.goalSwatch} aria-hidden="true" />
          {fill(labels.legendGoal, { goal })}
        </li>
      </ul>

      <p className="sr-only" aria-live="polite" data-key-announce="">
        {announced}
      </p>
    </div>
  );
}

const CHIP_LOOK: Record<KeyState, string | undefined> = {
  good: styles.good,
  weak: styles.weak,
  none: styles.none,
};

/**
 * The chip row: one button per reference key, in order, each at least 44px, `aria-pressed`, named with
 * its state (`E, objectif atteint`); a key never met is disabled. Its own component, so "Practise this
 * letter" (#329) adds an action beside it.
 */
export function KeyChips({
  keys,
  selected,
  onPick,
  labels,
  locale,
}: {
  keys: KeySheetKey[];
  selected: string;
  onPick: (char: string) => void;
  labels: KeySheetLabels;
  locale: Locale;
}) {
  return (
    <div role="group" aria-label={labels.chips} className={styles.chips} data-key-chips="">
      {keys.map((k) => {
        const on = k.char === selected;
        const cap = capOf(k.char, locale);
        return (
          <button
            key={k.char}
            type="button"
            className={cn(styles.chip, CHIP_LOOK[k.state], on && styles.on)}
            aria-pressed={on}
            aria-label={fill(labels.chip[k.state], { key: cap })}
            disabled={k.state === "none"}
            onClick={() => onPick(k.char)}
            data-key-chip={k.char}
            data-key-state={k.state}
          >
            {cap}
          </button>
        );
      })}
    </div>
  );
}
