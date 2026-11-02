import type { ReactNode } from "react";
import { fill, type LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

/** The header code's id: the invite row selects it when the clipboard is unavailable (#498). */
export const ROOM_CODE_ID = "lobby-room-code";

/**
 * bible 7.4 docket for the room: header row with the code (mono) and the `ROOM CODE` tag, then
 * `TYPISTS | n / 30` and `STATUS | WAITING`, then `children` (the invite rows, #498: one docket, so the
 * code prints once). `count` is null until the roster arrives.
 */
export function RoomCodeDocket({
  code,
  count,
  seats,
  labels,
  children,
}: {
  code: string;
  count: number | null;
  seats: number;
  labels: LobbyLabels;
  /** Rows after STATUS: `div` row groups of `dt` + `dd` (the dl's content model). */
  children?: ReactNode;
}) {
  return (
    <div className={styles.docket}>
      <div role="group" aria-label={labels.codeName} className={styles.docketHead}>
        <span id={ROOM_CODE_ID} className={styles.code}>
          {code}
        </span>
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
        {children}
      </dl>
    </div>
  );
}
