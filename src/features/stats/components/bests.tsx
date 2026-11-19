import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import { type BestsView, bestDate } from "../view/bests";
import { NBSP, oneDecimal, percent } from "../view/profile-figures";
import profile from "./profile.module.css";
import styles from "./bests.module.css";

export type BestsLabels = Messages["profile"]["bests"];

type Heading = "h2" | "h3" | "h4";
const below: Record<Heading, "h3" | "h4" | "h5"> = { h2: "h3", h3: "h4", h4: "h5" };

const DASH = "—";

/**
 * "Records personnels / Personal bests" (#999 C43; bible 14.3 "Personal bests", an extension: the
 * reference has no such section, so it takes the clean streaks' 7.4 dockets in the reference's
 * two-column grid). The section head, then two dockets side by side (stacked on phones): French versus
 * English (a real table of races, best and average clean WPM per language, and one verdict sentence)
 * and the bests per text type and length (a real table that scrolls sideways inside its own named
 * region when narrow, never the page). With no race on file only one sentence follows the head; with
 * one language the other's row reads dashes and the sentence asks for a race in it. Server-rendered,
 * no state, no motion.
 */
export function Bests({
  view,
  labels,
  locale,
  id,
  heading: Section,
}: {
  view: BestsView;
  labels: BestsLabels;
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const Docket = below[Section];
  const { verdict } = view;
  const verdictText =
    verdict === null
      ? null
      : verdict.kind === "only"
        ? labels.compare.only[verdict.language]
        : verdict.kind === "even"
          ? labels.compare.even
          : fill(labels.compare[verdict.kind], { diff: oneDecimal(verdict.diff, locale) });
  return (
    <section aria-labelledby={id} data-section="bests" data-bests={view.state}>
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Section id={id} className={profile.h2}>
            {labels.title}
          </Section>
        </div>
        <p className={profile.intro}>{labels.intro}</p>
      </div>
      {view.state === "none" ? (
        <p className={styles.none} data-bests-none="">
          {labels.none}
        </p>
      ) : (
        <div className={profile.pair}>
          <section
            aria-labelledby={`${id}-compare`}
            className={profile.docket}
            data-bests-compare=""
          >
            <div className={profile.docketHead}>
              <Docket id={`${id}-compare`} className={profile.docketTitle}>
                {labels.compare.title}
              </Docket>
              <span className={profile.inkTag}>{labels.compare.tag}</span>
            </div>
            <table className={profile.streaks}>
              <caption className="sr-only">{labels.compare.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{labels.compare.language}</th>
                  <th scope="col">{labels.compare.races}</th>
                  <th scope="col">{labels.compare.best}</th>
                  <th scope="col">{labels.compare.mean}</th>
                </tr>
              </thead>
              <tbody>
                {view.compare.map((c) => (
                  <tr key={c.language} data-bests-language={c.language}>
                    <th scope="row" className={profile.threshold}>
                      {labels.languages[c.language]}
                    </th>
                    <td className={cn(c.races === 0 && profile.muted)}>{c.races}</td>
                    <td className={profile.streakBest} data-bests-best="">
                      {c.bestWpm === null ? DASH : oneDecimal(c.bestWpm, locale)}
                    </td>
                    <td data-bests-mean="">
                      {c.meanWpm === null ? DASH : oneDecimal(c.meanWpm, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {verdictText ? (
              <p className={styles.verdict} data-bests-verdict={verdict?.kind}>
                {verdictText}
              </p>
            ) : null}
          </section>

          <section aria-labelledby={`${id}-table`} className={profile.docket} data-bests-table="">
            <div className={profile.docketHead}>
              <Docket id={`${id}-table`} className={profile.docketTitle}>
                {labels.table.title}
              </Docket>
              <span className={profile.inkTag}>{labels.table.tag}</span>
            </div>
            <div
              className={styles.scroll}
              role="region"
              aria-label={labels.table.region}
              tabIndex={0}
              data-bests-scroll=""
            >
              <table className={cn(profile.streaks, styles.table)}>
                <caption className="sr-only">{labels.table.caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{labels.table.language}</th>
                    <th scope="col" className={styles.textCol}>
                      {labels.table.text}
                    </th>
                    <th scope="col">{labels.table.best}</th>
                    <th scope="col">{labels.table.accuracy}</th>
                    <th scope="col" className={styles.dateCol}>
                      {labels.table.date}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr
                      key={`${r.language}-${r.textType}-${r.length}`}
                      data-best={`${r.language}-${r.textType}-${r.length}`}
                    >
                      <th scope="row" className={profile.threshold}>
                        {r.language}
                      </th>
                      <td className={styles.text}>
                        {`${labels.table.types[r.textType]} · ${labels.table.lengths[r.length]}`}
                      </td>
                      <td className={profile.streakBest} data-best-wpm="">
                        {oneDecimal(r.cleanWpm, locale)}
                      </td>
                      <td>{`${percent(r.accuracy, locale)}${NBSP}%`}</td>
                      <td className={styles.date}>{bestDate(r.achievedAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
