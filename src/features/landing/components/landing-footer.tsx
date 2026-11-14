import Image from "next/image";
import { getT } from "@/i18n";
import { LINKS, SOCIAL_LINKS, type SocialLink } from "../links";
import styles from "./footer.module.css";

type Messages = Awaited<ReturnType<typeof getT>>;
type Props = {
  brand: Messages["brand"];
  labels: Messages["landing"]["footer"];
  links?: typeof LINKS;
  social?: readonly SocialLink[];
};

/**
 * Footer (bible 14.1 item 10): brand column, PLAY / LEARN / AEGIS CORP. columns, social buttons, the gold
 * BUILT BY stamp and the bottom bar.
 */
export async function LandingFooter() {
  const t = await getT();
  return <FooterView brand={t.brand} labels={t.landing.footer} />;
}

/**
 * The footer from its labels. A link appears when its route ships (#875): an entry whose href is not in
 * `links` is left out, a column left with no entry is not rendered (heading included), and the social row
 * is not rendered while `social` is empty.
 */
export function FooterView({ brand, labels: f, links = LINKS, social = SOCIAL_LINKS }: Props) {
  const columns = [
    {
      title: f.play,
      links: [
        [f.links.quickRace, links.play],
        [f.links.createPrivateRace, links.play],
        [f.links.joinWithCode, links.play],
        [f.links.locker, links.locker],
      ],
    },
    {
      title: f.learn,
      links: [
        [f.links.guide, links.how], // in-page on the landing (#943)
        [f.links.teachers, links.teachers],
        [f.links.profile, links.profile],
      ],
    },
    {
      title: f.aegis,
      links: [
        [f.links.about, links.about],
        [f.links.privacy, links.privacy],
        [f.links.terms, links.terms],
        [f.links.contact, links.contact],
      ],
    },
  ]
    .map((column) => ({
      title: column.title,
      links: column.links.filter((entry): entry is [string, string] => entry[1] !== undefined),
    }))
    .filter((column) => column.links.length > 0);

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
              alt={brand.wordmarkAlt}
            />
          </div>
          <div className={styles.tagline}>{brand.tagline}</div>
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
        {social.length > 0 ? (
          <ul className={styles.social}>
            {social.map((entry) => (
              <li key={entry.key}>
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.socialLink}
                >
                  <span className={styles.socialTag} aria-hidden="true">
                    {entry.tag}
                  </span>
                  {f.social[entry.key]}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
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
