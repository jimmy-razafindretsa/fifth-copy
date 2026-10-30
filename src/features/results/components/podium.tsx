import { fill } from "@/i18n/format";
import { cn } from "@/lib/cn";
import {
  formatAccuracy,
  formatWpm,
  MEDAL_OF_PLACE,
  padDesk,
  placeSlots,
  type PlinthSlot,
  type PodiumLabels,
  type ReportEntry,
} from "../view/dawn-report";
import { PodiumMedal } from "./podium-medal";
import styles from "./podium.module.css";

export type PodiumProps = {
  entries: readonly ReportEntry[];
  viewerDesk: number | null;
  labels: PodiumLabels;
  /** `live` (default): the medal embeds; `still`: the gold stamps (the `/design` specimens). */
  medals?: "live" | "still";
};

/**
 * The Dawn report's podium (#300 C3, bible 14.4): three plinths for places 1, 2 and 3, read from the
 * entries as given (props only, no hook). In the DOM they come in place order (reading order = rank);
 * from 768px CSS stands them 2 | 1 | 3, the first tallest. A tie shares one plinth, a missing place
 * stays `UNFILLED`, a suspicious entry puts the `UNDER REVIEW` docket where its medal would hang.
 */
export function Podium({ entries, viewerDesk, labels, medals = "live" }: PodiumProps) {
  return (
    <ol className={styles.podium} aria-label={labels.title} data-podium>
      {placeSlots(entries).map((slot) => (
        <Plinth
          key={slot.place}
          slot={slot}
          viewerDesk={viewerDesk}
          labels={labels}
          still={medals === "still"}
        />
      ))}
    </ol>
  );
}

function Plinth({
  slot,
  viewerDesk,
  labels,
  still,
}: {
  slot: PlinthSlot;
  viewerDesk: number | null;
  labels: PodiumLabels;
  still: boolean;
}) {
  const { place, entries } = slot;
  const empty = entries.length === 0;
  const tied = entries.length > 1;
  const review = entries.some((e) => e.suspicious);
  const mine = viewerDesk !== null && entries.some((e) => e.desk === viewerDesk);
  const variant = MEDAL_OF_PLACE[place];
  return (
    <li
      className={styles.plinth}
      data-plinth={place}
      data-unfilled={empty || undefined}
      data-tied={tied || undefined}
      data-under-review={review || undefined}
      data-you={mine || undefined}
    >
      <div className={styles.grid}>
        <div className={styles.slot}>
          <div className={styles.frame} data-medal-slot>
            {empty ? null : review ? (
              <p className={styles.review}>{labels.underReview}</p>
            ) : (
              <PodiumMedal
                variant={variant}
                title={labels.medalTitle[variant]}
                fallback={labels.medal}
                still={still}
              />
            )}
          </div>
        </div>
        <div className={styles.cell}>
          <div className={styles.head}>
            <span className={styles.tag}>{fill(labels.place, { n: place })}</span>
            {tied && <span className={styles.tag}>{labels.tied}</span>}
          </div>
          {empty ? (
            <p className={styles.unfilled}>{labels.unfilled}</p>
          ) : (
            <ul className={styles.entries}>
              {entries.map((e) => (
                <Entry key={e.desk} entry={e} you={e.desk === viewerDesk} labels={labels} />
              ))}
            </ul>
          )}
        </div>
        <div className={styles.base} aria-hidden>
          {place}
        </div>
      </div>
    </li>
  );
}

function Entry({ entry, you, labels }: { entry: ReportEntry; you: boolean; labels: PodiumLabels }) {
  return (
    <li className={styles.entry} data-desk={entry.desk}>
      <p className={styles.who}>
        <span className={styles.desk}>{fill(labels.desk, { n: padDesk(entry.desk) })} · </span>
        <span className={cn(styles.name, you && styles.nameYou)}>{entry.name}</span>
        {entry.isBot && <span className={styles.tag}>{labels.bot}</span>}
        {you && <span className={styles.tag}>{labels.you}</span>}
        {entry.status !== "FINISHED" && (
          <span className={styles.status}>{labels.status[entry.status]}</span>
        )}
      </p>
      <p className={styles.figures}>
        <span className={styles.wpm}>{formatWpm(entry.wpm)}</span>
        <span className={styles.unit}>{labels.wpm}</span>
        <span className={styles.accuracy}>{formatAccuracy(entry.accuracy)}</span>
        <span className={styles.unit}>{labels.accuracy}</span>
      </p>
    </li>
  );
}
