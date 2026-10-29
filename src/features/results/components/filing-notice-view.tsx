import Link from "next/link";
import type { FilingLabels } from "../view/report-labels";
import styles from "./dawn-report.module.css";

/** The filing states without hooks: `/design#results` and the unit tests render it as is. */
export function FilingNoticeView({
  labels,
  backHref,
  late,
}: {
  labels: FilingLabels;
  backHref: string;
  late: boolean;
}) {
  if (late) {
    return (
      <div className={styles.filing} data-filing="late">
        <p role="alert" className={styles.errorLine}>
          <span className={styles.errorPrefix}>{labels.prefix}</span> {labels.late}
        </p>
        <Link href={backHref} className={styles.secondary}>
          {labels.back}
        </Link>
      </div>
    );
  }
  return (
    <div className={styles.filing} data-filing="waiting">
      <p role="status" className={styles.notice}>
        {labels.notice}
      </p>
    </div>
  );
}
