import { useId } from "react";
import { fill } from "@/i18n/format";
import { padDesk } from "../view/dawn-report";
import type { RankingLabels, RankingRow } from "../view/ranking";
import styles from "./ranking-table.module.css";

export type RankingTableProps = {
  rows: readonly RankingRow[];
  labels: RankingLabels;
};

/**
 * The Dawn report's ranking docket (#301, bible 14.4 "Ranking docket", 7.4): every desk in place order,
 * presentational (rows and labels only, no hook beyond the caption id). A real `<table>` laid out as one
 * CSS grid per row; overriding `display` drops the implicit table roles in Chromium, so each element
 * states its role. The docket scrolls inside itself (focusable, named by the caption) and its header row
 * sticks. The viewer's row carries the `YOU` tag and the red left rule; suspicious rows stay, tagged.
 */
export function RankingTable({ rows, labels }: RankingTableProps) {
  const captionId = useId();
  const { columns } = labels;
  return (
    // the docket scrolls, so it takes focus (axe scrollable-region-focusable) and a name
    <div
      className={styles.docket}
      role="region"
      tabIndex={0}
      aria-labelledby={captionId}
      data-ranking
    >
      <table className={styles.table} role="table">
        <caption id={captionId} className={styles.head}>
          <span className={styles.tag}>{labels.caption}</span>
        </caption>
        <thead className={styles.thead} role="rowgroup">
          <tr className={styles.row} role="row">
            <th scope="col" role="columnheader" className={styles.th} data-col="place">
              {columns.place}
            </th>
            <th
              scope="col"
              role="columnheader"
              colSpan={2}
              aria-colspan={2}
              className={styles.th}
              data-col="typist"
            >
              {columns.typist}
            </th>
            <th scope="col" role="columnheader" className={styles.th} data-col="desk">
              {columns.desk}
            </th>
            <th scope="col" role="columnheader" className={styles.th} data-col="wpm">
              {columns.wpm}
            </th>
            <th scope="col" role="columnheader" className={styles.th} data-col="accuracy">
              {columns.accuracy}
            </th>
            <th scope="col" role="columnheader" className={styles.th} data-col="status">
              {columns.status}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <Row key={row.desk} row={row} labels={labels} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, labels }: { row: RankingRow; labels: RankingLabels }) {
  return (
    <tr
      className={styles.row}
      role="row"
      data-place={row.place}
      data-desk={row.desk}
      data-you={row.you ? "true" : "false"}
      data-status={row.statusKey}
    >
      <td role="cell" className={styles.place} data-col="place">
        {row.place}
      </td>
      <td role="cell" className={styles.portraitCell} data-col="portrait">
        <span className={styles.portrait}>
          {row.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a lobby-scoped avatar route (#65), not a static asset
            <img src={row.avatarUrl} alt="" className={styles.avatar} />
          ) : (
            <span aria-hidden>{row.initials}</span>
          )}
        </span>
      </td>
      <td role="cell" className={styles.who} data-col="name">
        <span className={styles.name}>{row.name}</span>
        {row.isBot && <span className={styles.tag}>{labels.bot}</span>}
        {row.you && <span className={styles.tag}>{labels.you}</span>}
        {row.suspicious && <span className={styles.tag}>{labels.underReview}</span>}
      </td>
      <td role="cell" className={styles.desk} data-col="desk">
        {fill(labels.deskNumber, { n: padDesk(row.desk) })}
      </td>
      <td role="cell" className={styles.wpm} data-col="wpm">
        {row.wpm}
      </td>
      <td role="cell" className={styles.accuracy} data-col="accuracy">
        {`${row.accuracy} %`}
      </td>
      <td role="cell" className={styles.statusCell} data-col="status">
        <span className={styles.status}>{labels.status[row.statusKey]}</span>
      </td>
    </tr>
  );
}
