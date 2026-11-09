import { Button } from "@/components/ui";
import { fill, type Messages } from "@/i18n";
import type { Viewer } from "@/server/auth";
import { AUTH_LINKS } from "../auth-screen";
import styles from "./settings.module.css";

/**
 * The account section (#66 C6): a guest (or a visitor not yet on file) reads their typist name with the
 * `GUEST` tag and the way to an account; an account reads its username and the picture and data entries,
 * placeholders until the avatar dialog (#60) and the delete action (#81) land.
 */
export function AccountSection({
  viewer,
  t,
  idPrefix,
}: {
  viewer: Viewer | null;
  t: Messages;
  idPrefix: string;
}) {
  const titleId = `${idPrefix}-account`;
  const soonId = `${idPrefix}-soon`;
  const a = t.settings.account;
  const account = viewer !== null && !viewer.isGuest;
  return (
    <section className={styles.section} aria-labelledby={titleId} data-setting="account">
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {t.settings.sections.account}
        </h2>
      </div>
      {viewer && (
        <dl className={styles.rows}>
          <dt>{account ? a.username : a.typist}</dt>
          <dd>
            <span className={styles.name} data-account-name>
              {account ? viewer.name : fill(t.header.honorific, { name: viewer.name })}
            </span>
            {!account && <span className={styles.tag}>{a.guestTag}</span>}
          </dd>
        </dl>
      )}
      {account ? (
        <>
          <div className={styles.actions}>
            <Button variant="secondary" size="lg" disabled aria-describedby={soonId}>
              {a.picture}
            </Button>
            <Button variant="secondary" size="lg" disabled aria-describedby={soonId}>
              {a.deleteData}
            </Button>
          </div>
          <p id={soonId} className={styles.hint}>
            {a.soon}
          </p>
        </>
      ) : (
        <p className={styles.keep}>
          <span>{a.keep}</span>
          <a href={AUTH_LINKS.signUp} className={styles.link}>
            {a.signUp}
          </a>
        </p>
      )}
    </section>
  );
}
