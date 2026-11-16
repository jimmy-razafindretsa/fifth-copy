import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import { type ArchiveEntry, archiveDate, awardOf } from "../view/archive";
import { NBSP, oneDecimal, percent } from "../view/profile-figures";
import type { ProfileStreak } from "../view/streaks";
import type { ProfileLabels } from "./profile-screen";
import styles from "./profile.module.css";

type Heading = "h1" | "h2" | "h3" | "h4";

/**
 * "Séries sans faute" (#936, bible 14.3, reference `Profil.dc.html`): a 7.4 docket in the first cell of
 * the reference's two-column grid; its second cell (`Combinaisons suspectes`) is left out until its card,
 * so the docket spans the row. Header (the section's heading) with the ink tag, a real table of the four
 * thresholds, the foot. Server-rendered, no motion.
 */
export function StreaksDocket({
  streaks,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  streaks: ProfileStreak[];
  labels: ProfileLabels["streaks"];
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  return (
    <section aria-labelledby={id} data-section="streaks" className={styles.pair}>
      <div className={styles.docket}>
        <div className={styles.docketHead}>
          <Heading id={id} className={styles.docketTitle}>
            {labels.title}
          </Heading>
          <span className={styles.inkTag}>{labels.tag}</span>
        </div>
        <table className={styles.streaks}>
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labels.threshold}</th>
              <th scope="col">{labels.best}</th>
              <th scope="col">{labels.wpmDuring}</th>
              <th scope="col">{labels.current}</th>
            </tr>
          </thead>
          <tbody>
            {streaks.map((s) => (
              <tr key={s.threshold} data-streak={s.threshold}>
                <th scope="row" className={styles.threshold}>
                  {fill(labels.row, { threshold: s.threshold })}
                </th>
                <td className={styles.streakBest} data-streak-best="">
                  {s.best}
                </td>
                <td data-streak-wpm="">
                  {s.wpmDuring === null ? "—" : oneDecimal(s.wpmDuring, locale)}
                </td>
                <td
                  className={cn(s.current === 0 && styles.muted)}
                  data-streak-current=""
                  data-muted={s.current === 0 ? "" : undefined}
                >
                  {s.current}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.docketFoot}>{labels.foot}</p>
      </div>
    </section>
  );
}

/**
 * "Archives des courses" (#936, bible 14.3, reference `Profil.dc.html`): the section head, then a real
 * table in a 2px ink frame that scrolls sideways inside its own focusable, named region on phones
 * (`min-width: 720px`), never the page. Place 1 carries the gold `MÉDAILLE` tag (ink text), places 2
 * and 3 the ink `PODIUM` tag.
 */
export function ArchiveSection({
  archive,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  archive: ArchiveEntry[];
  labels: ProfileLabels["archive"];
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const count = archive.length;
  return (
    <section aria-labelledby={id} data-section="archive">
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>
            {count === 1 ? labels.kickerOne : fill(labels.kicker, { count })}
          </p>
          <Heading id={id} className={styles.h2}>
            {labels.title}
          </Heading>
        </div>
      </div>
      <div
        className={styles.archiveFrame}
        role="region"
        aria-label={labels.region}
        tabIndex={0}
        data-archive-scroll=""
      >
        <table className={styles.archive}>
          <caption className="sr-only">
            {count === 1 ? labels.captionOne : fill(labels.caption, { count })}
          </caption>
          <colgroup>
            <col className={styles.colDate} />
            <col className={styles.colNarrow} />
            <col className={styles.colMode} />
            <col className={styles.colNarrow} />
            <col className={styles.colNarrow} />
            <col className={styles.colAccuracy} />
            <col className={styles.colMode} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{labels.date}</th>
              <th scope="col">{labels.room}</th>
              <th scope="col">{labels.mode}</th>
              <th scope="col">{labels.place}</th>
              <th scope="col">{labels.wpm}</th>
              <th scope="col">{labels.accuracy}</th>
              <th scope="col">
                <span className="sr-only">{labels.award}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {archive.map((entry, i) => {
              const award = awardOf(entry.place);
              return (
                <tr key={`${entry.at}-${i}`} data-archive-row="">
                  <td>{archiveDate(entry.at, locale)}</td>
                  <td>{entry.room ?? labels.none}</td>
                  <td className={styles.mode}>{labels.modes[entry.mode]}</td>
                  <td className={styles.rank}>
                    {entry.place === null
                      ? labels.none
                      : entry.lobbySize === null
                        ? String(entry.place)
                        : `${entry.place} / ${entry.lobbySize}`}
                  </td>
                  <td>{oneDecimal(entry.cleanWpm, locale)}</td>
                  <td>{`${percent(entry.accuracy, locale)}${NBSP}%`}</td>
                  <td>
                    {award ? (
                      <span
                        className={award === "medal" ? styles.goldTag : styles.archiveTag}
                        data-award={award}
                      >
                        {labels.awards[award]}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
