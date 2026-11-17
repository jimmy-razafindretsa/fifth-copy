import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import type { KeyFile, KeyFileEntry } from "../view/key-file";
import { BLANK_FIGURE, oneDecimal } from "../view/profile-figures";
import styles from "./key-progress.module.css";
import profile from "./profile.module.css";

type Heading = "h2" | "h3" | "h4";
type Labels = Messages["profile"]["keyProgress"];

/** At or under this speed a day is the slow end of the scale (the reference's `heat`). */
export const HEAT_SLOW_WPM = 18;
/** At or over this speed a day is the fast end; the mid tone sits halfway, at 33. */
export const HEAT_FAST_WPM = 48;

/** `p` % of `a` into `b`, or the pure end when `p` is 0 or 100. */
const mix = (a: string, p: number, b: string) =>
  p <= 0 ? b : p >= 100 ? a : `color-mix(in srgb, ${a} ${p}%, ${b})`;

/**
 * "Rouge → Marine" (the reference's default `heatPalette`): a day's speed as a CSS colour through
 * token roles. Red (`primary`) at or under 18 WPM, the tan mid tone (`--heat-mid`, set by the module
 * from `fg` and `surface`) at 33, violet as a mark (`rival`, the file's navy) at or over 48, linear in
 * between. Pure; shared with nothing else, so a second palette is one more function.
 */
export function heatTone(wpm: number): string {
  const t = Math.max(0, Math.min(1, (wpm - HEAT_SLOW_WPM) / (HEAT_FAST_WPM - HEAT_SLOW_WPM)));
  return t <= 0.5
    ? mix("var(--heat-mid)", Math.round(t * 200), "var(--color-primary)")
    : mix("var(--color-rival)", Math.round((t - 0.5) * 200), "var(--heat-mid)");
}

/** The key as its cap reads, upper case in the locale (`é` -> `É`). */
const capOf = (char: string, locale: Locale) => char.toLocaleUpperCase(locale);

/**
 * A row's one sentence for assistive tech (the day cells are hidden): `E : moyenne 34,2 MPM, de 28,0 à
 * 41,3 sur 40 jours` / `E: average 34.2 WPM, from 28.0 to 41.3 over 40 days`, counting the days the key
 * has a value; `K : jamais rencontrée` / `K: never met` without a speed.
 */
export function rowLabel(entry: KeyFileEntry, labels: Labels, locale: Locale): string {
  const key = capOf(entry.char, locale);
  if (entry.averageWpm === null) return fill(labels.never, { key });
  const average = oneDecimal(entry.averageWpm, locale);
  const present = entry.series.filter((v): v is number => v !== null);
  if (present.length === 0) return fill(labels.rowAverage, { key, average });
  if (present.length === 1) return fill(labels.rowOne, { key, average });
  return fill(labels.row, {
    key,
    average,
    low: oneDecimal(Math.min(...present), locale),
    high: oneDecimal(Math.max(...present), locale),
    count: present.length,
  });
}

/** `JOUR 1 → 40` / `DAY 1 → 40`, the count of days on file; one day: `JOUR 1` / `DAY 1`. */
export function daysHead(count: number, labels: Labels): string {
  return count === 1 ? labels.dayOne : fill(labels.days, { count });
}

/**
 * "Progression par touche" (#962, bible 14.3, reference `Profil.dc.html` `RAPPORT D'APPRENTISSAGE`):
 * the section head, then one frame holding a real table in its own sideways-scrolling region: a head
 * row (`JOUR 1 → n`, `MOY. MPM`), then one row per key of `KeyFile.keys` (the key cap as row header,
 * one cell per file day shaded by `heatTone`, the empty cell on a day without a value, the average to
 * one decimal or `—`), and the legend `LENTE` gradient `RAPIDE`. The day cells are hidden from assistive
 * tech; each row says one sentence instead, so colour is never the only cue. Server-rendered, no motion.
 */
export function KeyProgress({
  keyFile,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  keyFile: KeyFile;
  labels: Labels;
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const days = keyFile.days.length;
  return (
    <section aria-labelledby={id} data-section="key-progress">
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <p className={profile.intro}>{labels.intro}</p>
      </div>
      <div className={styles.frame}>
        <div
          className={styles.scroll}
          role="region"
          aria-label={labels.region}
          tabIndex={0}
          data-key-progress-scroll=""
        >
          <table className={styles.grid}>
            <colgroup>
              <col className={styles.colKey} />
              <col />
              <col className={styles.colAverage} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{labels.key}</span>
                </th>
                <th scope="col" data-key-days="">
                  {daysHead(days, labels)}
                </th>
                <th scope="col" className={styles.average}>
                  {labels.average}
                </th>
              </tr>
            </thead>
            <tbody>
              {keyFile.keys.map((entry) => (
                <tr key={entry.char} data-key={entry.char} data-key-state={entry.state}>
                  <th scope="row" className={styles.cap}>
                    {capOf(entry.char, locale)}
                  </th>
                  <td className={styles.days}>
                    <div
                      aria-hidden="true"
                      className={styles.cells}
                      style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}
                    >
                      {entry.series.map((wpm, i) =>
                        wpm === null ? (
                          <span key={i} className={styles.empty} />
                        ) : (
                          <span
                            key={i}
                            className={styles.cell}
                            style={{ background: heatTone(wpm) }}
                          />
                        ),
                      )}
                    </div>
                    <span className="sr-only">{rowLabel(entry, labels, locale)}</span>
                  </td>
                  <td className={styles.average}>
                    {entry.averageWpm === null
                      ? BLANK_FIGURE
                      : oneDecimal(entry.averageWpm, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.legend} data-key-legend="">
          <span>{labels.slow}</span>
          <span className={styles.bar} aria-hidden="true" />
          <span>{labels.fast}</span>
        </div>
      </div>
    </section>
  );
}
