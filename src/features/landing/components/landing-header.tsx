import Image from "next/image";
import { getViewer } from "@/features/identity";
import { getTheme, LocaleToggle, ThemeToggle } from "@/features/preferences";
import { fill, getLocale, getT } from "@/i18n";
import { LINKS } from "../links";
import styles from "./header.module.css";

/**
 * Landing header (bible 14.1 item 1, reference `Fifth Copy Landing.dc.html`): FC icon + FIFTH COPY,
 * the guide link, EN/FR, NIGHT SHIFT, the guest docket and SIGN IN. The docket only shows a viewer
 * that exists: reads never create guests (ADR 0009), so a first visit has nothing to file yet.
 */
export async function LandingHeader() {
  const [t, locale, theme, viewer] = await Promise.all([
    getT(),
    getLocale(),
    getTheme(),
    getViewer(),
  ]);
  return (
    <header className={styles.header}>
      <a href={LINKS.home} className={styles.brand}>
        <Image
          className={styles.monogram}
          src="/brand/monogram-red.svg"
          width={40}
          height={40}
          alt=""
          loading="eager"
        />
        <span className={styles.brandName}>{t.brand.name}</span>
      </a>
      <nav aria-label={t.header.navLabel} className={styles.nav}>
        <a href={LINKS.guide} className={styles.navLink}>
          {t.header.guide}
        </a>
        <LocaleToggle locale={locale} label={t.header.languageLabel} />
        <ThemeToggle theme={theme} label={t.header.nightShift} />
        {viewer ? (
          <div className={styles.docket}>
            <span>{fill(t.header.honorific, { name: viewer.name })}</span>
            {viewer.isGuest ? <span className={styles.tag}>{t.header.guestTag}</span> : null}
          </div>
        ) : null}
        <a href={LINKS.signIn} className={styles.signIn}>
          {t.header.signIn}
        </a>
      </nav>
    </header>
  );
}
