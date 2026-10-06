import { getT } from "@/i18n";
import { cn } from "@/lib/cn";
import { EmbedFrame } from "@/components/ui";
import { EMBEDS } from "../links";
import shared from "./landing.module.css";
import styles from "./sections.module.css";

/** Medal showcase (bible 14.1 item 9, 13): the spinnable medal embed beside its decoration card. */
export async function MedalShowcase() {
  const t = await getT();
  const m = t.landing.medal;
  return (
    <section className={styles.medal} aria-labelledby="medal-title">
      <div className={styles.medalFrame}>
        <EmbedFrame src={EMBEDS.medal} title={m.frameTitle} />
      </div>
      <div className={styles.medalText}>
        <div className={shared.kicker}>{m.kicker}</div>
        <h2 id="medal-title" className={cn(shared.h2, styles.medalTitle)}>
          {m.title}
        </h2>
        <p className={styles.medalBody}>{m.body}</p>
      </div>
    </section>
  );
}
