import { getT } from "@/i18n";
import { cn } from "@/lib/cn";
import shared from "./landing.module.css";
import styles from "./sections.module.css";
import { Star } from "./star";

/** The story (bible 14.1 item 4): headline, pull-quote stamp, three paragraphs, a big faint star. */
export async function StorySection() {
  const t = await getT();
  const s = t.landing.story;
  return (
    <section className={styles.story} aria-labelledby="story-title">
      <Star size={180} tone="faintRed" spin={90} at={{ right: -40, top: 40 }} />
      <Star
        size={28}
        tone="red"
        spin={26}
        at={{ left: "46%", top: 96 }}
        className={styles.smallStar}
      />
      <Star
        size={18}
        tone="ink"
        spin={20}
        at={{ left: "49%", top: 140 }}
        className={styles.smallStar}
      />
      <div className={styles.storyLead}>
        <div className={shared.kicker}>{s.kicker}</div>
        <h2 id="story-title" className={styles.storyTitle}>
          {s.title}
        </h2>
        <blockquote className={cn(shared.stamp, styles.quote)}>{s.quote}</blockquote>
      </div>
      <div className={styles.storyBody}>
        <p>
          <b>{s.lead}</b> {s.p1}
        </p>
        <p>{s.p2}</p>
        <p>{s.p3}</p>
      </div>
    </section>
  );
}
