import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import type { KeyFilePair } from "../view/key-file";
import { BLANK_FIGURE, NBSP, oneDecimal } from "../view/profile-figures";
import profile from "./profile.module.css";
import styles from "./suspect-pairs.module.css";

type Heading = "h2" | "h3" | "h4";
export type SuspectPairsLabels = Messages["profile"]["suspectPairs"];

/** One pair's figures as the row shows and reads them (#965 C2). */
export function pairCells(
  pair: KeyFilePair,
  top: number,
  labels: SuspectPairsLabels,
  locale: Locale,
) {
  const name = pair.pair.toLocaleUpperCase(locale);
  const rate = `${oneDecimal(pair.errorRate * 100, locale)}${NBSP}%`;
  const speed = pair.wpm === null ? null : `${Math.round(pair.wpm)}${NBSP}${labels.wpm}`;
  return {
    name,
    rate,
    speed: speed ?? BLANK_FIGURE,
    /** The bar's width: the pair's error rate over the list's highest, one decimal of a percent. */
    width: top > 0 ? Math.round(Math.min(1, pair.errorRate / top) * 1000) / 10 : 0,
    sentence: fill(labels.row, { pair: name, rate, speed: speed ?? labels.noSpeed }),
  };
}

/**
 * One letter pair (#965): the pair, a decorative bar of its error rate against `top`, the rate and the
 * speed, read as one sentence. Takes a pair record, so a later "all pairs" page reuses it.
 */
export function SuspectPairRow({
  pair,
  top,
  labels,
  locale,
}: {
  pair: KeyFilePair;
  top: number;
  labels: SuspectPairsLabels;
  locale: Locale;
}) {
  const cells = pairCells(pair, top, labels, locale);
  return (
    <li className={styles.row} data-pair={pair.pair}>
      <span className="sr-only">{cells.sentence}</span>
      <span className={styles.pair} aria-hidden="true">
        {cells.name}
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${cells.width}%` }} data-pair-bar="" />
      </span>
      <span className={styles.rate} aria-hidden="true">
        {cells.rate}
      </span>
      <span className={styles.speed} aria-hidden="true">
        {cells.speed}
      </span>
    </li>
  );
}

/**
 * "Combinaisons suspectes" (#965, bible 14.3, reference `Profil.dc.html` lines 162-176): the 7.4 docket
 * in the second cell of the clean streaks' grid, the streak docket's header pattern (the heading, the
 * ink tag), one row per `KeyFile.pairs` entry in its order (at most six), the foot. Server-rendered, no
 * motion; the caller leaves it out when there is no pair.
 */
export function SuspectPairs({
  pairs,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  pairs: readonly KeyFilePair[];
  labels: SuspectPairsLabels;
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const top = Math.max(0, ...pairs.map((p) => p.errorRate));
  return (
    <section aria-labelledby={id} data-section="suspect-pairs">
      <div className={profile.docket}>
        <div className={profile.docketHead}>
          <Heading id={id} className={profile.docketTitle}>
            {labels.title}
          </Heading>
          <span className={profile.inkTag}>{labels.tag}</span>
        </div>
        <ul className={styles.list} aria-labelledby={id}>
          {pairs.map((pair) => (
            <SuspectPairRow key={pair.pair} pair={pair} top={top} labels={labels} locale={locale} />
          ))}
        </ul>
        <p className={profile.docketFoot}>{labels.foot}</p>
      </div>
    </section>
  );
}
