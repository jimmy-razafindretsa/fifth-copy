import { getT } from "@/i18n";
import shared from "./landing.module.css";
import styles from "./sections.module.css";

/** How a race runs (bible 14.1 item 7): 01/02/03 dockets with red, ink and violet top rules. */
export async function HowSection() {
  const t = await getT();
  const h = t.landing.how;
  return (
    <section id="how" className={styles.how} aria-labelledby="how-title">
      <div className={shared.headStack}>
        <div className={shared.kicker}>{h.kicker}</div>
        <h2 id="how-title" className={shared.h2}>
          {h.title}
        </h2>
      </div>
      <ol className={styles.steps}>
        {h.steps.map((step, i) => (
          <li key={step.title} className={styles.step}>
            <div className={styles.stepNo} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className={styles.stepTitle}>{step.title}</h3>
            <p className={styles.stepBody}>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
