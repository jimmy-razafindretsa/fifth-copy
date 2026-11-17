"use client";

import { useState } from "react";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import type { Census } from "../view/census";
import {
  CENSUS_INITIAL,
  CENSUS_KEYS,
  CENSUS_METRICS,
  CENSUS_MODES,
  type CensusChoice,
  CURVE_BOX,
  censusPlot,
  censusShown,
} from "../view/census-plot";
import styles from "./census.module.css";
import profile from "./profile.module.css";

export type TypistCensusLabels = Messages["profile"]["census"];

export type TypistCensusProps = {
  /** `getCensus`'s result (ADR 0023): shapes, the viewer's own figures; `null` under the floor. */
  census: Census | null;
  labels: TypistCensusLabels;
  locale: Locale;
  /** The heading's id (the section's name). */
  id: string;
  /** The section heading's level, one below the file's name. */
  heading: "h2" | "h3" | "h4";
};

/**
 * `Ta place au Ministère` (#967, bible 14.3 "Personnel file", `Profil.dc.html` `RECENSEMENT DES
 * DACTYLOS`): where the viewer stands among all typists. The client leaf holds the two choices (the
 * tabs: speed or accuracy; the toggle: average or best) and draws one of the four distributions it was
 * handed; switching asks nothing of the server. Absent, with no placeholder, when `censusShown` is false.
 */
export function TypistCensus(props: TypistCensusProps) {
  const [choice, setChoice] = useState<CensusChoice>(CENSUS_INITIAL);
  return <CensusSection {...props} choice={choice} onChoice={setChoice} />;
}

/** The section at a given choice: stateless, so the server and the tests draw it as is. */
export function CensusSection({
  census,
  labels,
  locale,
  id,
  heading: Heading,
  choice,
  onChoice,
}: TypistCensusProps & { choice: CensusChoice; onChoice?: (choice: CensusChoice) => void }) {
  if (!censusShown(census)) return null;
  const key = CENSUS_KEYS[choice.mode][choice.metric];
  const plot = censusPlot(census[key], choice.mode, labels.units[choice.mode], locale);
  if (!plot) return null;
  const [before, after] = labels.sentence.split("{percentile}") as [string, string];
  const subject = labels.subjects[key];
  const sentence = fill(labels.sentence, { subject, percentile: plot.percentile });

  return (
    <section aria-labelledby={id} data-section="census" data-census={key}>
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <div role="group" aria-label={labels.modesLabel} className={styles.tabs}>
          {CENSUS_MODES.map(({ id: mode }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={choice.mode === mode}
              className={styles.tab}
              onClick={() => onChoice?.({ ...choice, mode })}
              data-census-mode={mode}
            >
              {labels.modes[mode]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.frame}>
        <p className={styles.sentence} data-census-sentence="">
          {fill(before, { subject })}
          <span className={styles.percentile} data-census-percentile="">
            {plot.percentile}
          </span>
          {after}
        </p>
        <div
          role="img"
          aria-label={fill(labels.plot, { sentence, value: plot.value })}
          className={styles.plot}
          data-census-plot=""
        >
          <div className={styles.bars}>
            {plot.bars.map((bar, i) => (
              <div
                key={i}
                className={cn(styles.bar, bar.beaten ? styles.beaten : styles.ahead)}
                style={{ height: bar.height }}
                data-census-bar={bar.beaten ? "beaten" : "ahead"}
              />
            ))}
          </div>
          <svg
            viewBox={`0 0 ${CURVE_BOX.width} ${CURVE_BOX.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className={styles.curve}
          >
            <path d={plot.curve} />
          </svg>
          <div className={styles.marker} style={{ left: plot.left }} data-census-marker="">
            <div
              className={cn(styles.tag, plot.flip ? styles.tagLeft : styles.tagRight)}
              data-census-tag={plot.flip ? "left" : "right"}
            >
              {fill(labels.you, { value: plot.value })}
            </div>
          </div>
        </div>
        <div className={styles.ticks} aria-hidden="true" data-census-ticks="">
          {plot.ticks.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <div className={styles.controls}>
          <div role="group" aria-label={labels.metricsLabel} className={styles.toggle}>
            {CENSUS_METRICS.map(({ id: metric }) => (
              <button
                key={metric}
                type="button"
                aria-pressed={choice.metric === metric}
                className={styles.option}
                onClick={() => onChoice?.({ ...choice, metric })}
                data-census-metric={metric}
              >
                {labels.metrics[metric]}
              </button>
            ))}
          </div>
          <ul className={styles.legend}>
            <li>
              <i className={cn(styles.swatch, styles.beaten)} aria-hidden="true" />
              {labels.legend.beaten}
            </li>
            <li>
              <i className={cn(styles.swatch, styles.ahead)} aria-hidden="true" />
              {labels.legend.ahead}
            </li>
            <li>
              <i className={styles.curveSwatch} aria-hidden="true" />
              {labels.legend.cumulative}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
