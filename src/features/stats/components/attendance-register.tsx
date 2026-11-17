import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import {
  ATTENDANCE_LEVELS,
  type AttendanceDay,
  type AttendanceMonth,
  dayName,
  goalPercent,
  monthName,
  type ProfileAttendance,
  weekHeads,
} from "../view/attendance";
import { NBSP } from "../view/profile-figures";
import styles from "./attendance.module.css";
import profile from "./profile.module.css";

type Heading = "h2" | "h3" | "h4";
type Labels = Messages["profile"]["attendance"];

/** The legend's five swatches, one per level: the share of the goal each starts from. */
const LEGEND_PERCENT = [0, 25, 50, 75, 100] as const;

/** `6 JOURS`, `1 JOUR`, `0 JOUR` / `6 DAYS`, `1 DAY`, `0 DAYS`: the locale's plural rule. */
export function daysLabel(count: number, labels: Labels, locale: Locale): string {
  const one = new Intl.PluralRules(locale).select(count) === "one";
  return fill(one ? labels.dayOne : labels.days, { count });
}

/** A day's accessible name: its date, then its figures (`12 novembre : 11 min, 75 % de l'objectif`). */
export function dayLabel(
  day: AttendanceDay,
  goalMin: number,
  labels: Labels,
  locale: Locale,
): string {
  const named = dayName(day.day, locale);
  const date = day.today ? fill(labels.today, { date: named }) : named;
  if (day.future) return fill(labels.cellFuture, { date });
  if (day.level === 0) return fill(labels.cellNone, { date });
  return fill(labels.cell, {
    date,
    minutes: Math.floor(day.minutes + 1e-9),
    percent: goalPercent(day.minutes, goalMin),
  });
}

/** The month's weeks, Monday first: `null` for the blanks before day 1 and after the last day. */
function weeksOf(month: AttendanceMonth): (AttendanceDay | null)[][] {
  const cells: (AttendanceDay | null)[] = [
    ...Array.from({ length: month.blanks }, () => null),
    ...month.days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/**
 * "Registre de présence" (#330, bible 14.3, reference `Profil.dc.html` `FEUILLE DE POINTAGE`): the
 * section head with three 7.4 cells (current streak, best, active days), then three month blocks in one
 * frame, each a real table (the month as its caption, the weekdays as column heads, one cell per day
 * shaded by its level, today ringed, days after today dashed and muted), and the legend of the daily
 * goal. Every day's cell is named by its figures, so colour is never the only cue. Server-rendered, no
 * motion.
 */
export function AttendanceRegister({
  attendance,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  attendance: ProfileAttendance;
  labels: Labels;
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const heads = weekHeads(locale);
  const stats = [
    {
      key: "current",
      label: labels.current,
      value: daysLabel(attendance.currentStreak, labels, locale),
    },
    { key: "best", label: labels.best, value: daysLabel(attendance.bestStreak, labels, locale) },
    {
      key: "active",
      label: labels.active,
      value: `${attendance.activeDays} / ${attendance.windowDays}`,
    },
  ];
  return (
    <section aria-labelledby={id} data-section="attendance">
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <dl className={styles.stats}>
          {stats.map((s) => (
            <div key={s.key} className={styles.stat} data-attendance={s.key}>
              <dt className={styles.statLabel}>{s.label}</dt>
              <dd className={styles.statValue}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className={styles.frame}>
        <div className={styles.months}>
          {attendance.months.map((month) => (
            <table key={month.key} className={styles.month} data-month={month.key}>
              <caption className={styles.monthName}>{monthName(month.key, locale)}</caption>
              <thead>
                <tr>
                  {heads.map((h, i) => (
                    <th key={i} scope="col" abbr={h.long} className={styles.weekday}>
                      <span aria-hidden="true">{h.narrow}</span>
                      <span className="sr-only">{h.long}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeksOf(month).map((week, w) => (
                  <tr key={w}>
                    {week.map((day, d) =>
                      day === null ? (
                        <td key={d} className={styles.cell} />
                      ) : (
                        <td
                          key={d}
                          className={styles.cell}
                          data-day={day.day}
                          data-level={day.level ?? undefined}
                          data-today={day.today ? "" : undefined}
                          data-future={day.future ? "" : undefined}
                        >
                          <span
                            className={cn(
                              styles.day,
                              day.future ? styles.future : styles[`level${day.level ?? 0}`],
                              day.today && styles.today,
                            )}
                          >
                            <span aria-hidden="true">{day.date}</span>
                            <span className="sr-only">
                              {dayLabel(day, attendance.goalMin, labels, locale)}
                            </span>
                          </span>
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <div className={styles.legend} role="group" aria-label={labels.legend} data-legend="">
          <span className={styles.goal}>{fill(labels.goal, { goal: attendance.goalMin })}</span>
          {ATTENDANCE_LEVELS.map((level) => (
            <span
              key={level}
              className={cn(styles.swatch, styles[`level${level}`])}
              data-level={level}
            >
              {`${LEGEND_PERCENT[level]}${NBSP}%`}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
