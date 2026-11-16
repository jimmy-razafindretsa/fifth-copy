import Image from "next/image";
import {
  AccountControl,
  getAvatarUser,
  getViewer,
  gradeGrace,
  gradeRead,
  type AvatarUser,
  type GradeSource,
  type GradeStep,
} from "@/features/identity";
import { getTheme, LocaleToggle, ThemeToggle } from "@/features/preferences";
import { getLocale, getT, type Messages } from "@/i18n";
import type { Locale } from "@/i18n/locale";
import type { Viewer } from "@/server/auth";
import { LINKS } from "../links";
import styles from "./header.module.css";

type Current = "profile" | "landing";

/**
 * Landing header (bible 14.1 item 1, reference `Fifth Copy Landing.dc.html`): FC icon + FIFTH COPY,
 * the guide link, EN/FR, NIGHT SHIFT, then the account control (#36): the viewer's docket and SIGN IN or
 * SIGN OUT. The docket only shows a viewer that exists: reads never create guests (ADR 0009).
 * The docket is the one link to the viewer's Personnel file (#932; the separate MY FILE link went in #951:
 * both did the same thing). On the landing (`current="landing"`, `/` and
 * `/welcome`) the guide link is the in-page `#how` anchor. A viewer elsewhere gets `← MENU` beside the
 * brand (#951), back to the Home menu.
 * With `grade` (the stats feature's `getRank`, handed in by the route: the landing never imports stats,
 * ADR 0021) an account's docket ends with its grade tag (#969). The read runs beside the avatar's; done
 * within `GRADE_GRACE_MS` it is in the first paint, else it streams into the tag's own boundary. A guest
 * or a visitor triggers none.
 */
export async function LandingHeader({
  current,
  grade,
}: { current?: Current; grade?: GradeSource | undefined } = {}) {
  const [t, locale, theme, viewer] = await Promise.all([
    getT(),
    getLocale(),
    getTheme(),
    getViewer(),
  ]);
  // read beside the avatar; the header waits for it at most GRADE_GRACE_MS, then it streams (#969 C4)
  const read = gradeRead(grade, viewer);
  const [avatar] = await Promise.all([
    viewer ? getAvatarUser(viewer) : null,
    read ? gradeGrace(read) : null,
  ]);
  return (
    <HeaderBar
      t={t}
      locale={locale}
      theme={theme ?? "light"}
      viewer={viewer}
      avatar={avatar}
      current={current}
      grade={read}
    />
  );
}

/**
 * The header as drawn, from what `LandingHeader` read (also the `/design` specimens, #969 C7, with a
 * fixed viewer and grade and their own nav name so the specimens' landmarks stay distinct).
 */
export function HeaderBar({
  t,
  locale,
  theme,
  viewer,
  avatar,
  current,
  grade,
  navLabel,
}: {
  t: Messages;
  locale: Locale;
  /** no cookie = paper here, whatever the OS (bible 3.2, #651) */
  theme: "light" | "dark";
  viewer: Viewer | null;
  avatar: AvatarUser | null;
  current?: Current | undefined;
  /** The account's pending grade read (#969); null for a guest, a visitor or no read. */
  grade: Promise<GradeStep | null> | null;
  navLabel?: string | undefined;
}) {
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
      {/* #951: a viewer's `/` is the Home menu; every other page offers the way back to it */}
      {viewer && current !== "landing" ? (
        <a href={LINKS.home} className={styles.back} aria-label={t.header.backToMenuLabel}>
          <span aria-hidden="true">←</span>
          <span className={styles.backText}>{t.header.backToMenu}</span>
        </a>
      ) : null}
      <nav aria-label={navLabel ?? t.header.navLabel} className={styles.nav}>
        {/* on the landing itself the guide stays the in-page anchor (#943 C5) */}
        <a href={current === "landing" ? LINKS.how : LINKS.guide} className={styles.navLink}>
          {t.header.guide}
        </a>
        <LocaleToggle locale={locale} label={t.header.languageLabel} />
        <ThemeToggle theme={theme} label={t.header.nightShift} />
        <AccountControl
          viewer={viewer}
          avatar={avatar}
          labels={{ honorific: t.header.honorific, myFile: t.header.myFileName, ...t.auth.account }}
          grade={
            grade
              ? {
                  read: grade,
                  ranks: t.landing.clerk.ranks,
                  spoken: t.header.gradeName,
                  locale,
                }
              : undefined
          }
          classes={{
            docket: styles.docket,
            docketName: styles.docketName,
            tag: styles.tag,
            signIn: styles.signIn,
            avatar: styles.avatar,
            grade: styles.grade,
          }}
        />
      </nav>
    </header>
  );
}
