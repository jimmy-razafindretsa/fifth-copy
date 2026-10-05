import { getT } from "@/i18n";
import { cn } from "@/lib/cn";
import { Star } from "@/components/ui";
import styles from "./sections.module.css";

/** Ticker band (bible 6, 8.4): two identical halves scroll on the skewed ink band; decorative only. */
export async function TickerBand() {
  const t = await getT();
  const half = (key: string) => (
    <div className={styles.tickerHalf} key={key}>
      {t.landing.ticker.map((word, i) => (
        <span key={i} className="contents">
          <span>{word}</span>
          <Star size={38} tone="red" spin={14} className={styles.tickerStar} />
        </span>
      ))}
    </div>
  );
  return (
    <section aria-hidden="true" className={cn(styles.ticker)}>
      <div className={styles.tickerTrack}>
        {half("a")}
        {half("b")}
      </div>
    </section>
  );
}
