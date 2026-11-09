import type { SaveStatus } from "./use-preference-save";
import styles from "./settings.module.css";

export type StatusLabels = { pending: string; saved: string; errorPrefix: string; error: string };

/**
 * The save state beside a section's name (#66): a polite status that reads `FILING…` while the change is
 * on its way and `FILED` once it is filed (the bible 2 save stamp's word), empty otherwise.
 */
export function SaveState({ status, labels }: { status: SaveStatus; labels: StatusLabels }) {
  const text = status === "pending" ? labels.pending : status === "saved" ? labels.saved : "";
  return (
    <p role="status" className={styles.status} data-status={status}>
      {text}
    </p>
  );
}

/** The 7.4 inline error line under a refused control: `RETURNED ·` and one sentence. */
export function SaveError({ id, labels }: { id: string; labels: StatusLabels }) {
  return (
    <p id={id} role="alert" className={styles.errorLine}>
      <span className={styles.errorPrefix}>{labels.errorPrefix}</span> {labels.error}
    </p>
  );
}
