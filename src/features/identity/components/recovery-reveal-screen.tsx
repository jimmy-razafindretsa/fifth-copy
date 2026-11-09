import Link from "next/link";
import { Alert } from "@/components/ui";
import { getT } from "@/i18n";
import { acknowledgeRecovery } from "../actions/acknowledge-recovery";
import styles from "./auth.module.css";
import { recoveryCardLabels } from "./recover-screen";
import { RecoveryCard } from "./recovery-card";

/**
 * The one-time reveal after sign-up (#46 C2, bible 14.3 "Recovery code"): kicker `FORM 1-D`, H1
 * `RECOVERY CODE`, one sentence, then one paper docket (header + ink tag `SHOWN ONCE`) holding the
 * recovery card, whose continue files the acknowledgement. `words` null (reload, other tab, expired):
 * the `ALREADY SHOWN` info row and a link home instead; the code is never shown twice.
 */
export async function RecoveryRevealScreen({ words }: { words: readonly string[] | null }) {
  const t = await getT();
  const r = t.auth.recovery.reveal;
  return (
    <section className={styles.screen} aria-labelledby="reveal-title">
      <div className={styles.column}>
        <div className={styles.kicker}>{r.kicker}</div>
        <h1 id="reveal-title" className={`${styles.title} ink-misregister`}>
          {r.title}
        </h1>
        <p className={styles.lede}>{r.lede}</p>
        <div className={styles.docket}>
          <div className={styles.docketHeader}>
            <span className={styles.docketForm}>{r.form}</span>
            <span className={styles.tag}>{r.tag}</span>
          </div>
          {words ? (
            <RecoveryCard
              words={words}
              labels={recoveryCardLabels(t)}
              action={acknowledgeRecovery}
            />
          ) : (
            <div className={styles.section}>
              <Alert title={r.gone.title}>
                <p>{r.gone.body}</p>
              </Alert>
              <Link href="/" className={styles.link}>
                {r.gone.link}
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
