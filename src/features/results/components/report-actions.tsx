import Link from "next/link";
import type { ReportAction } from "../view/report-labels";
import styles from "./dawn-report.module.css";

/**
 * The Dawn report's action row (#143, #863, bible 14.4), presentational: the links in list order,
 * `RACE AGAIN` as the 7.1 primary stamp back to the waiting room and `BACK TO THE FRONT DESK →` as the
 * 7.1 secondary link; a guest member's `signup` entry is the one 7.4 docket row under them, one sentence
 * and the 7.1 secondary link `OPEN A FILE →` to `/sign-up`.
 */
export function ReportActions({ actions }: { actions: readonly ReportAction[] }) {
  const links = actions.filter((a) => a.kind !== "signup");
  const prompt = actions.find((a) => a.kind === "signup");
  return (
    <div className={styles.actionRow}>
      <div className={styles.actions}>
        {links.map((action) => (
          <Link
            key={action.kind}
            href={action.href}
            className={action.kind === "again" ? styles.stamp : styles.secondary}
            data-action={action.kind}
          >
            {action.label}
          </Link>
        ))}
      </div>
      {prompt?.kind === "signup" && (
        <p className={styles.prompt} data-prompt>
          <span>{prompt.prompt}</span>
          <Link href={prompt.href} className={styles.secondary} data-action="signup">
            {prompt.label}
          </Link>
        </p>
      )}
    </div>
  );
}
