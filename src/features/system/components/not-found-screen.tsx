import { Stamp } from "@/components/ui";
import { getT } from "@/i18n";
import { MajorStage } from "./major-stage";
import styles from "./not-found.module.css";

/** Where the two actions go: the landing, and its play section (QUICK RACE, private race, code). */
export const NOT_FOUND_LINKS = { home: "/", join: "/#play" } as const;

/**
 * The in-world 404 (card 397): a form-404 docket beside the Major in 3D. Rendered by
 * `src/app/not-found.tsx`, so Next answers it with a 404 status.
 */
export async function NotFoundScreen() {
  const t = await getT();
  const s = t.system.notFound;
  return (
    <section className={styles.screen} aria-labelledby="not-found-title">
      <MajorStage title={s.stageTitle} hint={s.stageHint} />
      <div className={styles.file}>
        <div className={styles.kicker}>{s.kicker}</div>
        <h1 id="not-found-title" className={styles.title}>
          {s.title}
        </h1>
        <Stamp
          lines={[s.stamp]}
          tone="red"
          size="md"
          rotation={-6}
          role="status"
          className={styles.fileStamp}
        />
        <p className={styles.body}>{s.body}</p>
        <p className={styles.body}>{s.body2}</p>
        <dl className={styles.docket}>
          {s.rows.map(([label, value]) => (
            <div key={label} className={styles.row}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.actions}>
          <a href={NOT_FOUND_LINKS.home} className={styles.primary}>
            {s.home}
          </a>
          <a href={NOT_FOUND_LINKS.join} className={styles.secondary}>
            {s.join}
          </a>
        </div>
      </div>
    </section>
  );
}
