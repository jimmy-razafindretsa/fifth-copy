import { fill, type LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

/**
 * bible 7.4 docket for the room: header row with the code (mono) and the `ROOM CODE` tag, then
 * `TYPISTS | n / 30` and `STATUS | WAITING`. `count` is null until the roster arrives.
 */
export function RoomCodeDocket({
  code,
  count,
  seats,
  labels,
}: {
  code: string;
  count: number | null;
  seats: number;
  labels: LobbyLabels;
}) {
  return (
    <div className={styles.docket}>
      <div role="group" aria-label={labels.codeName} className={styles.docketHead}>
        <span className={styles.code}>{code}</span>
        <span className={styles.tag}>{labels.codeTag}</span>
      </div>
      <dl className={styles.facts}>
        <div className={styles.row}>
          <dt className={styles.label}>{labels.typists}</dt>
          <dd className={styles.value}>
            {fill(labels.typistsValue, { n: count ?? "—", max: seats })}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>{labels.status}</dt>
          <dd className={styles.value}>{labels.waiting}</dd>
        </div>
      </dl>
    </div>
  );
}
