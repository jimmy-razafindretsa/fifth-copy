import styles from "./auth.module.css";

/** The landing's play section: QUICK RACE, private race, practice, code (reads never create guests). */
export const GUEST_HREF = "/#play";

export type GuestLabels = { title: string; body: string; cta: string };

/**
 * "Play as guest" (#36 C8, R223): a newsprint docket under the form with the 7.1 ink button as a link to
 * the landing's play section. The guest identity is created there, on the first race (ADR 0009).
 */
export function GuestCta({ labels }: { labels: GuestLabels }) {
  return (
    <section className={styles.guest} aria-labelledby="guest-cta-title">
      <h2 id="guest-cta-title" className={styles.guestTitle}>
        {labels.title}
      </h2>
      <p className={styles.guestBody}>{labels.body}</p>
      <a href={GUEST_HREF} className={styles.inkButton}>
        {labels.cta}
      </a>
    </section>
  );
}
