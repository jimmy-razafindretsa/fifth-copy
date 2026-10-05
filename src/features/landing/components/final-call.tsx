import { getT } from "@/i18n";
import { cn } from "@/lib/cn";
import { Star } from "@/components/ui";
import shared from "./landing.module.css";
import styles from "./sections.module.css";

/** Final call (bible 14.1 item 8): red halftone band, REPORT TO YOUR DESK., the inverted primary. */
export async function FinalCall({ action }: { action: React.ReactNode }) {
  const t = await getT();
  return (
    <section className={styles.final} aria-labelledby="final-title">
      <Star size={150} tone="faintPaper" spin={80} at={{ right: "30%", top: -30 }} />
      <Star size={34} tone="paper" spin={26} at={{ right: "26%", bottom: 26 }} />
      <Star size={20} tone="gold" spin={18} at={{ right: "31%", bottom: 70 }} />
      <div className={styles.finalText}>
        <div className={cn(shared.kicker, styles.finalKicker)}>{t.landing.final.kicker}</div>
        <h2 id="final-title" className={styles.finalTitle}>
          {t.landing.final.title}
        </h2>
      </div>
      {action}
    </section>
  );
}
