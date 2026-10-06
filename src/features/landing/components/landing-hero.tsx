import Image from "next/image";
import { Star } from "@/components/ui";
import { getT } from "@/i18n";
import { drawFeedFacts } from "../feed";
import styles from "./hero.module.css";
import { LiveFeed } from "./live-feed";
import { TypingStrip } from "./typing-strip";

/**
 * Landing hero (bible 14.1 item 2, reference `Fifth Copy Landing.dc.html`). `primary` is the QUICK RACE
 * button, `entries` the private-race entries (card 99); both come from the lobby feature.
 */
export async function LandingHero({
  primary,
  entries,
}: {
  primary: React.ReactNode;
  entries: React.ReactNode;
}) {
  const t = await getT();
  const feed = drawFeedFacts();
  return (
    <section className={styles.hero} aria-labelledby="hero-title" id="play">
      {/* the reference's four stars; the big red one stays at 24px: the text column is the taller one (bible 14.1) */}
      <Star size={64} tone="red" spin={50} at={{ left: "2%", bottom: 24, opacity: 0.9 }} />
      <Star size={30} tone="ink" spin={30} at={{ left: "44%", top: 30 }} />
      <Star size={22} tone="gold" spin={24} at={{ left: "38%", top: 78 }} />
      <Star size={46} tone="red" spin={60} at={{ right: "2%", bottom: 70 }} />
      <div className={styles.heroInner}>
        <div className={styles.heroMain}>
          <div className={styles.kicker}>{t.landing.kicker}</div>
          <h1 id="hero-title" className={styles.wordmark}>
            <Image
              className={`${styles.wordmarkImg} ${styles.onPaper}`}
              src="/brand/wordmark-red-on-paper.svg"
              width={217}
              height={87}
              alt={t.brand.wordmarkAlt}
              loading="eager"
            />
            <Image
              className={`${styles.wordmarkImg} ${styles.onInk}`}
              src="/brand/wordmark-red-on-ink.svg"
              width={217}
              height={87}
              alt={t.brand.wordmarkAlt}
              loading="eager"
            />
          </h1>
          <div className={styles.tagline}>{t.landing.tagline}</div>
          <p className={styles.pitch}>{t.landing.pitch}</p>
          <TypingStrip key={t.landing.tape.sentence} labels={t.landing.tape} />
          <div className={styles.cta}>
            <div className={styles.ctaRow}>
              {primary}
              <p className={styles.note}>{t.landing.quick.note}</p>
            </div>
            <div className={styles.entries}>{entries}</div>
          </div>
        </div>
        <LiveFeed
          labels={t.landing.feed}
          roomNumber={feed.roomNumber}
          elapsedSeconds={feed.elapsedSeconds}
        />
      </div>
    </section>
  );
}
