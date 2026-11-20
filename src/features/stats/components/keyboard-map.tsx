"use client";

import { useState } from "react";
import { guideHref } from "@/features/guide/client";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import {
  circleSize,
  coreSize,
  type KeyboardMap as KeyboardMapData,
  rowPercent,
} from "../view/keyboard-map";
import { keyName, type KeyboardMapLabels } from "../view/key-name";
import { NBSP } from "../view/profile-figures";
import styles from "./keyboard-map.module.css";
import profile from "./profile.module.css";

export type { KeyboardMapLabels };

/** One layout of the switch: its id, its settings label and its map, already computed on the server. */
export type KeyboardMapLayout = { id: string; name: string; map: KeyboardMapData };

export type KeyboardMapProps = {
  /** The product's layouts in the settings order, each mapped (`keyboardMapOf`). */
  layouts: KeyboardMapLayout[];
  /** The layout drawn first: the viewer's saved one, else the locale's default. */
  initial: string;
  labels: KeyboardMapLabels;
  locale: Locale;
  /** The heading's id (the section's name). */
  id: string;
  heading: "h2" | "h3" | "h4";
};

/**
 * "Carte du clavier" (#324, bible 14.3, `Profil.dc.html` `PLAN DE LA MACHINE`): the client leaf holds the
 * chosen layout and draws its map from props; switching asks nothing of the server. The server render
 * already draws `initial`, so the map reads without JavaScript.
 */
export function KeyboardMap(props: KeyboardMapProps) {
  const [layout, setLayout] = useState(props.initial);
  return <KeyboardMapSection {...props} layout={layout} onLayout={setLayout} />;
}

/** The section at a given layout: stateless, so the tests draw it as is. */
export function KeyboardMapSection({
  layouts,
  initial,
  labels,
  locale,
  id,
  heading: Heading,
  layout,
  onLayout,
}: KeyboardMapProps & { layout: string; onLayout?: (id: string) => void }) {
  const shown = layouts.find((l) => l.id === layout) ?? layouts.find((l) => l.id === initial);
  if (!shown) return null;
  const { map } = shown;
  const width = (units: number) => `calc(${(units * map.unit).toFixed(2)}% - 4px)`;

  return (
    <section aria-labelledby={id} data-section="keyboard-map" data-keyboard-layout={shown.id}>
      <div className={profile.head}>
        <div>
          <p className={profile.kicker} data-keyboard-kicker="">
            {fill(labels.kicker, { layout: shown.name })}
          </p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <div role="group" aria-label={labels.layouts} className={styles.switch}>
          {layouts.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={l.id === shown.id}
              className={styles.option}
              onClick={() => onLayout?.(l.id)}
              data-keyboard-option={l.id}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.frame}>
        <div
          role="group"
          aria-label={fill(labels.board, { layout: shown.name })}
          className={styles.board}
          data-keyboard-board=""
        >
          {map.rows.map((row) => (
            <div key={row.id} className={styles.row} data-keyboard-row={row.id}>
              {row.pad > 0 ? (
                <div className={styles.pad} style={{ width: width(row.pad) }} aria-hidden="true">
                  <span className={styles.padLabel}>
                    {labels.pads[row.id as keyof KeyboardMapLabels["pads"]]}
                  </span>
                </div>
              ) : null}
              {row.keys.map((key) => {
                const guide = guideHref(key.char);
                // a special character's key is a link to its guide entry (#999 C29); the rest are pictures
                const Key = guide ? "a" : "div";
                return (
                  <Key
                    key={key.char}
                    {...(guide
                      ? {
                          href: guide,
                          "aria-label": fill(labels.guide, { name: keyName(key, labels, locale) }),
                          "data-key-guide": "",
                        }
                      : { role: "img", "aria-label": keyName(key, labels, locale) })}
                    className={cn(
                      styles.key,
                      !key.typed && styles.untyped,
                      guide && styles.guideKey,
                    )}
                    style={{ width: width(1) }}
                    data-key={key.char}
                    data-key-typed={key.typed ? "true" : "false"}
                  >
                    <span className={styles.cap} data-key-cap="">
                      {key.cap}
                    </span>
                    {key.typed ? (
                      <span
                        className={styles.circle}
                        style={{ width: `${circleSize(key.share)}%` }}
                        data-key-circle=""
                      >
                        <span
                          className={styles.core}
                          style={{ width: `${coreSize(key.errorRate)}%` }}
                          data-key-core=""
                        />
                      </span>
                    ) : null}
                  </Key>
                );
              })}
            </div>
          ))}
          <div className={styles.space} aria-hidden="true" />
        </div>

        <div className={styles.foot}>
          <dl className={styles.shares} data-keyboard-shares="">
            {map.rows.map((row) => (
              <div key={row.id} className={styles.cell} data-row-share={row.id}>
                <dt className={styles.cellLabel}>{labels.rows[row.id]}</dt>
                <dd className={styles.cellValue}>{`${rowPercent(row.share)}${NBSP}%`}</dd>
              </div>
            ))}
          </dl>
          <ul className={styles.legend} data-keyboard-legend="">
            <li>
              <i className={styles.sizeSwatch} aria-hidden="true" />
              {labels.legendSize}
            </li>
            <li>
              <i className={styles.coreSwatch} aria-hidden="true" />
              {labels.legendCore}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
