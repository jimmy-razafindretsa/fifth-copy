import Image from "next/image";
import { AccountControl, getAvatarUser, getViewer } from "@/features/identity";
import { getTheme, LocaleToggle, ThemeToggle } from "@/features/preferences";
import { getLocale, getT } from "@/i18n";
import { cn } from "@/lib/cn";
import { LINKS } from "../links";
import styles from "./header.module.css";

/**
 * Landing header (bible 14.1 item 1, reference `Fifth Copy Landing.dc.html`): FC icon + FIFTH COPY,
 * the guide link, EN/FR, NIGHT SHIFT, then the account control (#36): the viewer's docket and SIGN IN or
 * SIGN OUT. The docket only shows a viewer that exists: reads never create guests (ADR 0009).
 * A viewer also gets MY FILE (#932, from 481px up; red and ruled on `/profile`, `current="profile"`), and
 * the docket links to their Personnel file at every width. On the landing (`current="landing"`, `/` and
 * `/welcome`) the guide link is the in-page `#how` anchor.
 */
export async function LandingHeader({ current }: { current?: "profile" | "landing" } = {}) {
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
        {/* on the landing itself the guide stays the in-page anchor (#943 C5) */}
        <a href={current === "landing" ? LINKS.how : LINKS.guide} className={styles.navLink}>
          {t.header.guide}
        </a>
        {viewer ? (
          <a
            href={LINKS.profile}
            className={cn(styles.navLink, styles.myFile)}
            aria-current={current === "profile" ? "page" : undefined}
          >
            {t.header.myFile}
          </a>
        ) : null}
        <LocaleToggle locale={locale} label={t.header.languageLabel} />
        {/* no cookie = paper here, whatever the OS (bible 3.2, #651) */}
        <ThemeToggle theme={theme ?? "light"} label={t.header.nightShift} />
        <AccountControl
          viewer={viewer}
          avatar={avatar}
          labels={{ honorific: t.header.honorific, myFile: t.header.myFileName, ...t.auth.account }}
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
