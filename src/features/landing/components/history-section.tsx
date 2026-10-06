import { getT } from "@/i18n";
import shared from "./landing.module.css";
import styles from "./sections.module.css";

/** A little history (bible 14.1 item 6): four cards in an ink-gapped grid, then the bridge line. */
export async function HistorySection() {
  const t = await getT();
  const h = t.landing.history;
  return (
    <section className={styles.history} aria-labelledby="history-title">
      <div className={styles.historyHead}>
        <div className={shared.headStack}>
          <div className={shared.kicker}>{h.kicker}</div>
          <h2 id="history-title" className={shared.h2}>
            {h.title}
          </h2>
        </div>
        <p className={styles.intro}>{h.intro}</p>
      </div>
      <div className={styles.cards}>
        {h.cards.map((card) => (
          <article key={card.title} className={styles.card}>
            <h3 className={styles.cardTitle}>{card.title}</h3>
            <p className={styles.cardBody}>{card.body}</p>
          </article>
        ))}
      </div>
      <p className={styles.bridge}>{h.bridge}</p>
    </section>
  );
}
