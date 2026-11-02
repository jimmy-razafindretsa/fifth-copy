import type { ReactNode } from "react";
import { fill, getLocale, getT } from "@/i18n";
import { privacyContentFor, termsContentFor } from "../content";
import { PRIVACY_UPDATED, TERMS_UPDATED, type PrivacySection } from "../content/types";
import styles from "./privacy-screen.module.css";

/**
 * Links a section carries under its text. The settings route lands with #66 and self-service deletion with
 * #81: the text says "soon", the link is already where it will live.
 */
export const PRIVACY_LINKS = { delete: "/settings#account" } as const;

/** The conduct rules (#91) sit under the `rules` section with prefixed anchors: their `avatars` id is taken. */
export const ruleAnchor = (id: string) => `rules-${id}`;

const pad = (n: number) => String(n).padStart(2, "0");

function Body({ section, level }: { section: PrivacySection; level: "h2" | "h3" }) {
  return (
    <>
      {section.paragraphs.map((p) => (
        <p key={p} className={styles.body}>
          {p}
        </p>
      ))}
      {section.list ? (
        <ul className={level === "h2" ? styles.list : `${styles.list} ${styles.listSmall}`}>
          {section.list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * The privacy page (card #76, design bible 14.3 "Privacy"): the form-file header of the not-found pattern
 * (kicker, H1, 7.4 docket) on newsprint, then a 7.4 docket table of contents beside the sections on paper.
 * Text only from the typed content (plain strings, no markup). `header` is the site header, hidden in print.
 */
export async function PrivacyScreen({ header }: { header: ReactNode }) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  const s = t.privacy;
  const sections = privacyContentFor(locale);
  const terms = termsContentFor(locale);
  return (
    <>
      <div className={styles.noPrint}>{header}</div>
      <main className={styles.screen} id="top">
        <header className={styles.file}>
          <div className={styles.kicker}>{s.kicker}</div>
          <h1 id="privacy-title" className={styles.title}>
            {s.heading}
          </h1>
          <p className={styles.intro}>{s.intro}</p>
          <dl className={styles.docket}>
            {s.rows.map(([label, value]) => (
              <div key={label} className={styles.row}>
                <dt>{label}</dt>
                <dd>{fill(value ?? "", { date: PRIVACY_UPDATED })}</dd>
              </div>
            ))}
          </dl>
        </header>
        <div className={styles.layout}>
          <nav className={styles.toc} aria-label={s.tocLabel}>
            <div className={styles.tocHead}>
              <span className={styles.tag}>{s.tocTag}</span>
            </div>
            <ol className={styles.tocList}>
              {sections.map((section, i) => (
                <li key={section.id} className={styles.tocRow}>
                  <span className={styles.tocNum} aria-hidden="true">
                    {pad(i + 1)}
                  </span>
                  <a href={`#${section.id}`} className={styles.tocLink}>
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className={styles.sections}>
            {sections.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                className={styles.section}
                aria-labelledby={`${section.id}-title`}
              >
                <div className={styles.sectionNum} aria-hidden="true">
                  № {pad(i + 1)}
                </div>
                <h2 id={`${section.id}-title`} className={styles.h2}>
                  {section.heading}
                </h2>
                <Body section={section} level="h2" />
                {section.id === "delete" ? (
                  <p className={styles.linkRow}>
                    <a href={PRIVACY_LINKS.delete} className={styles.secondary}>
                      {s.deleteLink}
                    </a>
                  </p>
                ) : null}
                {section.id === "rules" ? (
                  <p className={styles.sectionNum}>{fill(s.rulesUpdated, { date: TERMS_UPDATED })}</p>
                ) : null}
                {section.id === "rules"
                  ? terms.map((rule) => (
                      <section
                        key={rule.id}
                        id={ruleAnchor(rule.id)}
                        className={styles.rule}
                        aria-labelledby={`${ruleAnchor(rule.id)}-title`}
                      >
                        <h3 id={`${ruleAnchor(rule.id)}-title`} className={styles.h3}>
                          {rule.heading}
                        </h3>
                        <Body section={rule} level="h3" />
                      </section>
                    ))
                  : null}
                <a href="#top" className={`${styles.backToTop} ${styles.noPrint}`}>
                  {s.backToTop}
                </a>
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
