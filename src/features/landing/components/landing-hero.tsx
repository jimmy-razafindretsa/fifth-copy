import Image from "next/image";
import { getT } from "@/i18n";
import styles from "./landing.module.css";

const STARS = [styles.star1, styles.star2, styles.star3, styles.star4];

/**
 * Landing hero (bible 14.1 item 2, reference `Fifth Copy Landing.dc.html` hero). `actions` fills the
 * row under the pitch (#99); `aside` is the right column (live feed, #497).
 */
export async function LandingHero({
  actions,
  aside,
}: {
  actions: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const t = await getT();
  return (
    <section className={styles.hero}>
      {STARS.map((star) => (
        <div key={star} aria-hidden="true" className={`${styles.star} ${star}`} />
      ))}
      <div className={styles.heroInner}>
        <div className={styles.heroMain}>
          <div className={styles.kicker}>{t.landing.kicker}</div>
          <h1 className={styles.wordmark}>
            <Image
              className={`${styles.wordmarkImg} ${styles.onPaper}`}
              src="/brand/wordmark-red-on-paper.svg"
              width={217}
              height={87}
              alt={t.brand.wordmarkAlt}
              priority
            />
            <Image
              className={`${styles.wordmarkImg} ${styles.onInk}`}
              src="/brand/wordmark-red-on-ink.svg"
              width={217}
              height={87}
              alt={t.brand.wordmarkAlt}
              priority
            />
          </h1>
          <div className={styles.tagline}>{t.landing.tagline}</div>
          <p className={styles.pitch}>{t.landing.pitch}</p>
          <div className={styles.actions}>{actions}</div>
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
    </section>
  );
}
