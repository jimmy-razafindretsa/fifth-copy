import { useId } from "react";
import { fill } from "@/i18n/format";
import { formatAccuracy, formatWpm } from "../view/dawn-report";
import type { BonusTally, PersonalStats } from "../view/personal";
import type { PersonalLabels } from "../view/report-labels";
import styles from "./personal-card.module.css";

export type PersonalCardProps = { stats: PersonalStats; labels: PersonalLabels };

/**
 * The personal stats card (#864, #302, bible 14.4 "Personal stats card", 7.4): the viewer's own copy of
 * the race, presentational (stats and labels only). One 7.4 docket of sections: the header (the ink tag
 * that names it, the place `№ n`), the `UNDER REVIEW` row of a suspicious result, the figures (clean WPM,
 * ADR 0016; accuracy; the status when not filed), then the bonuses as `SENT` / `RECEIVED` rows.
 * Extension point: the WPM graph, the keys and the tip (sibling cards) and the personal-best flag (#321)
 * are further sections after these, on the same `PersonalStats`. No gold (bible 3), no motion.
 */
export function PersonalCard({ stats, labels }: PersonalCardProps) {
  const tagId = useId();
  return (
    <section
      className={styles.docket}
      aria-labelledby={tagId}
      data-personal
      data-desk={stats.desk}
      data-suspicious={stats.suspicious ? "true" : "false"}
    >
      <div className={styles.head}>
        <h2 id={tagId} className={styles.tag}>
          {labels.tag}
        </h2>
        <span className={styles.place} data-field="place">
          {fill(labels.place, { n: stats.place })}
        </span>
      </div>
      {stats.suspicious && (
        <p className={styles.review} data-review>
          {labels.underReview}
        </p>
      )}
      <Figures stats={stats} labels={labels} />
      <Bonuses stats={stats} labels={labels} />
    </section>
  );
}

function Figures({ stats, labels }: PersonalCardProps) {
  return (
    <div className={styles.section} data-section="figures">
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt className={styles.unit}>{labels.wpm}</dt>
          <dd className={styles.wpm} data-field="wpm">
            {formatWpm(stats.wpm)}
          </dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.unit}>{labels.accuracy}</dt>
          <dd className={styles.accuracy} data-field="accuracy">
            {formatAccuracy(stats.accuracy)}
          </dd>
        </div>
      </dl>
      {stats.status !== "FINISHED" && (
        <p className={styles.statusLine}>
          <span className={styles.status} data-field="status">
            {labels.status[stats.status]}
          </span>
        </p>
      )}
    </div>
  );
}

function Bonuses({ stats, labels }: PersonalCardProps) {
  return (
    <dl className={styles.rows} data-section="bonuses">
      <BonusRow row="sent" label={labels.sent} tallies={stats.bonuses.sent} labels={labels} />
      <BonusRow
        row="received"
        label={labels.received}
        tallies={stats.bonuses.received}
        labels={labels}
      />
    </dl>
  );
}

function BonusRow({
  row,
  label,
  tallies,
  labels,
}: {
  row: "sent" | "received";
  label: string;
  tallies: readonly BonusTally[];
  labels: PersonalLabels;
}) {
  return (
    <div className={styles.row} data-row={row}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>
        {tallies.length === 0 ? (
          <span className={styles.none}>{labels.none}</span>
        ) : (
          <ul className={styles.bonuses}>
            {tallies.map((t) => (
              <li key={t.kind} className={styles.bonus} data-kind={t.kind}>
                <span className={styles.bonusName}>{labels.bonus[t.kind]}</span>{" "}
                <span className={styles.count}>{fill(labels.count, { n: t.count })}</span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
