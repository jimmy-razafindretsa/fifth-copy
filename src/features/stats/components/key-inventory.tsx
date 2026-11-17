import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import type { KeyFile, KeyFileEntry } from "../view/key-file";
import { type BarLook, inventoryRows } from "../view/key-inventory";
import { BLANK_FIGURE, NBSP, oneDecimal } from "../view/profile-figures";
import styles from "./key-inventory.module.css";
import profile from "./profile.module.css";

type Heading = "h2" | "h3" | "h4";
export type KeyInventoryLabels = Messages["profile"]["keyInventory"];

/** The key as its cap reads, upper case in the locale (`é` -> `É`). */
const capOf = (char: string, locale: Locale) => char.toLocaleUpperCase(locale);

const LOOK: Record<BarLook, string | undefined> = {
  good: styles.good,
  weak: styles.weak,
  ink: styles.ink,
  red: styles.red,
  muted: styles.muted,
};

/**
 * One key's figures as the table reads them (#964 C3): `41,3 MPM, objectif atteint`, `1 204`, `48`,
 * `4,0 %`; `—` for a speed or a rate the key does not have.
 */
export function inventoryCells(entry: KeyFileEntry, labels: KeyInventoryLabels, locale: Locale) {
  const whole = new Intl.NumberFormat(`${locale}-CA`, { maximumFractionDigits: 0 });
  return {
    speed:
      entry.averageWpm === null
        ? BLANK_FIGURE
        : `${oneDecimal(entry.averageWpm, locale)}${NBSP}${labels.wpm}, ${
            entry.state === "good" ? labels.reached : labels.under
          }`,
    strokes: whole.format(entry.hits),
    errors: whole.format(entry.errors),
    ratio:
      entry.errorRate === null
        ? BLANK_FIGURE
        : `${oneDecimal(entry.errorRate * 100, locale)}${NBSP}%`,
  };
}

/**
 * "Vitesse, frappes et fautes" (#964, bible 14.3, reference `Profil.dc.html` `INVENTAIRE DES TOUCHES`):
 * the section head, then one frame holding, in its own sideways-scrolling region, the four bar rows of
 * `inventoryRows` (one bar per reference key; the speed row on a fixed 0-60 scale with the dashed goal
 * line, a bar at or over it violet, under it red), the 30 key caps, and the goal legend. The bars are
 * hidden from assistive tech; a visually hidden table gives the same figures. Server-rendered, no motion.
 */
export function KeyInventory({
  keyFile,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  keyFile: KeyFile;
  labels: KeyInventoryLabels;
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const rows = inventoryRows(keyFile);
  return (
    <section aria-labelledby={id} data-section="key-inventory">
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
          data-key-inventory-scroll=""
        >
          <div className={styles.chart} aria-hidden="true">
            {rows.map((row) => (
              <div key={row.id} className={styles.row} data-inventory-row={row.id}>
                <span className={styles.label}>{labels.rows[row.id]}</span>
                <div className={styles.bars} style={{ height: `${row.height}px` }}>
                  {row.bars.map((bar) => (
                    <span
                      key={bar.char}
                      className={cn(styles.bar, bar.height !== null && LOOK[bar.look])}
                      style={bar.height === null ? undefined : { height: `${bar.height}%` }}
                      data-bar={bar.char}
                      data-bar-look={bar.height === null ? "none" : bar.look}
                    />
                  ))}
                  {row.goalAt !== null ? (
                    <span
                      className={styles.goal}
                      style={{ bottom: `${row.goalAt}%` }}
                      data-inventory-goal=""
                    />
                  ) : null}
                </div>
              </div>
            ))}
            <div className={styles.row}>
              <span />
              <div className={styles.caps} data-inventory-caps="">
                {keyFile.keys.map((k) => (
                  <span key={k.char}>{capOf(k.char, locale)}</span>
                ))}
              </div>
            </div>
          </div>
          <table className="sr-only" data-inventory-table="">
            <caption>{labels.table.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{labels.table.key}</th>
                <th scope="col">{labels.table.speed}</th>
                <th scope="col">{labels.table.strokes}</th>
                <th scope="col">{labels.table.errors}</th>
                <th scope="col">{labels.table.ratio}</th>
              </tr>
            </thead>
            <tbody>
              {keyFile.keys.map((entry) => {
                const cells = inventoryCells(entry, labels, locale);
                return (
                  <tr key={entry.char} data-key={entry.char}>
                    <th scope="row">{capOf(entry.char, locale)}</th>
                    <td>{cells.speed}</td>
                    <td>{cells.strokes}</td>
                    <td>{cells.errors}</td>
                    <td>{cells.ratio}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className={styles.legend} data-inventory-legend="">
          <li>
            <i className={styles.goalSwatch} aria-hidden="true" />
            {fill(labels.legendGoal, { goal: keyFile.goal })}
          </li>
        </ul>
      </div>
    </section>
  );
}
