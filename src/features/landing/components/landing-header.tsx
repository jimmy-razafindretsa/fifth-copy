import Image from "next/image";
import { AccountControl, getAvatarUser, getViewer } from "@/features/identity";
import { getTheme, LocaleToggle, ThemeToggle } from "@/features/preferences";
import { getLocale, getT } from "@/i18n";
import { LINKS } from "../links";
import styles from "./header.module.css";

/**
 * Landing header (bible 14.1 item 1, reference `Fifth Copy Landing.dc.html`): FC icon + FIFTH COPY,
 * the guide link, EN/FR, NIGHT SHIFT, then the account control (#36): the viewer's docket and SIGN IN or
 * SIGN OUT. The docket only shows a viewer that exists: reads never create guests (ADR 0009).
 */
export async function LandingHeader() {
  const [t, locale, theme, viewer] = await Promise.all([
    getT(),
    getLocale(),
    getTheme(),
    getViewer(),
  ]);
  const avatar = viewer ? await getAvatarUser(viewer) : null;
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
        {/* no cookie = paper here, whatever the OS (bible 3.2, #651) */}
        <ThemeToggle theme={theme ?? "light"} label={t.header.nightShift} />
        <AccountControl
          viewer={viewer}
          avatar={avatar}
          labels={{ honorific: t.header.honorific, ...t.auth.account }}
          classes={{
            docket: styles.docket,
            docketName: styles.docketName,
            tag: styles.tag,
            signIn: styles.signIn,
            avatar: styles.avatar,
          }}
        />
      </nav>
    </header>
  );
}
