import Link from "next/link";
import { Stamp } from "@/components/ui";
import type { LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

/**
 * The removed viewer's docket (#133, bible 14.3, the 7.4 exit docket recipe of #233): named by the ink
 * `Stamp` `REMOVED` in its own clipped band, one deadpan sentence, then the 7.1 ink link back to the
 * front desk under a 2px ink rule. A docket in the flow: no dialog, no focus move. Terminal: nothing on
 * the page reconnects.
 */
export function RemovedDocket({ labels }: { labels: LobbyLabels["remove"]["docket"] }) {
  return (
    <section aria-label={labels.stamp} data-removed="" className={styles.removed}>
      <div className={styles.removedStamp}>
        <Stamp size="md" tone="ink" rotation="auto" seed="lobby-removed" lines={[labels.stamp]} />
      </div>
      <p className={styles.removedText}>{labels.sentence}</p>
      <div className={styles.removedActions}>
        <Link href="/" className={`${styles.ink} ${styles.removedLink}`}>
          {labels.back}
        </Link>
      </div>
    </section>
  );
}
