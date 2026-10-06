import Image from "next/image";
import { getT } from "@/i18n";
import { LINKS, SOCIAL_LINKS } from "../links";
import styles from "./footer.module.css";

/**
 * Footer (bible 14.1 item 10): brand column, PLAY / LEARN / AEGIS CORP. columns, social buttons, the gold
 * BUILT BY stamp and the bottom bar.
 */
export async function LandingFooter() {
  const t = await getT();
  const f = t.landing.footer;
  const columns = [
    {
      title: f.play,
      links: [
        [f.links.quickRace, LINKS.play],
        [f.links.createPrivateRace, LINKS.play],
        [f.links.joinWithCode, LINKS.play],
        [f.links.locker, LINKS.locker],
      ],
    },
    {
      title: f.learn,
      links: [
        [f.links.guide, LINKS.guide],
        [f.links.teachers, LINKS.teachers],
        [f.links.profile, LINKS.profile],
      ],
    },
    {
      title: f.aegis,
      links: [
        [f.links.about, LINKS.about],
        [f.links.privacy, LINKS.privacy],
        [f.links.terms, LINKS.terms],
        [f.links.contact, LINKS.contact],
      ],
    },
  ] as const;

  return (
    <footer className={styles.footer}>
      <div className={styles.grid}>
        <div className={styles.brand}>
          <div className={styles.wordmark}>
            <Image
              className={styles.wordmarkImg}
              src="/brand/wordmark-red-on-ink.svg"
              width={217}
              height={87}
              alt={t.brand.wordmarkAlt}
            />
          </div>
          <div className={styles.tagline}>{t.brand.tagline}</div>
          <p className={styles.about}>{f.about}</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} className={styles.col} aria-label={column.title}>
            <h3 className={styles.colTitle}>{column.title}</h3>
            {column.links.map(([label, href]) => (
              <a key={label} href={href} className={styles.colLink}>
                {label}
              </a>
            ))}
          </nav>
        ))}
      </div>
      <div className={styles.row}>
        <ul className={styles.social}>
          {SOCIAL_LINKS.map((social) => (
            <li key={social.key}>
              <a
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialLink}
              >
                <span className={styles.socialTag} aria-hidden="true">
                  {social.tag}
                </span>
                {f.social[social.key]}
              </a>
            </li>
          ))}
        </ul>
        <div className={styles.aegis}>
          {f.builtBy}
          <br />
          {f.builtByName}
        </div>
      </div>
      <div className={styles.bar}>
        <span>{f.copyright}</span>
        <span>{f.privacyLine}</span>
      </div>
    </footer>
  );
}
