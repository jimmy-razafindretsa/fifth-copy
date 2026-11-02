import Link from "next/link";
import type { ReportAction } from "../view/report-labels";
import styles from "./dawn-report.module.css";

/**
 * The Dawn report's action row (#143, bible 14.4 extension), presentational: `RACE AGAIN` as the 7.1
 * primary stamp link back to the waiting room, otherwise the 7.1 secondary link to the front desk.
 */
export function ReportActions({ action }: { action: ReportAction }) {
  return (
    <div className={styles.actions}>
      <Link
        href={action.href}
        className={action.kind === "again" ? styles.stamp : styles.secondary}
        data-action={action.kind}
      >
        {action.label}
      </Link>
    </div>
  );
}
