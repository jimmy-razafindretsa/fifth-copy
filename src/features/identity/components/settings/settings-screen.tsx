import { getT } from "@/i18n";
import type { Viewer } from "@/server/auth";
import type { UpdatePreferences } from "../../actions/update-preferences";
import type { Preferences } from "../../schema";
import { AccountSection, type AccountAvatar } from "./account-section";
import { LanguagePicker } from "./language-picker";
import { LayoutPicker } from "./layout-picker";
import { SoundToggle } from "./sound-toggle";
import { ThemePicker } from "./theme-picker";
import type { SaveStatus } from "./use-preference-save";
import styles from "./settings.module.css";

type SectionKey = "layout" | "theme" | "language" | "sound";

/**
 * The settings docket (#66): header `FORM 1-F` + ink tag, then the sections split by the dashed docket
 * rule. Each section gets the current value and the save action as props (the extension point: a new
 * preference is one more section). `/design` passes `initialStatus` to show a save state.
 */
export async function SettingsDocket({
  viewer,
  preferences,
  action,
  initialStatus = {},
  idPrefix = "settings",
  avatar,
}: {
  viewer: Viewer | null;
  preferences: Preferences;
  action: UpdatePreferences;
  initialStatus?: Partial<Record<SectionKey, SaveStatus>>;
  /** Unique per docket on a page (`/design` shows several). */
  idPrefix?: string;
  /** The picture dialog's data (#60); absent on `/design` specimens. */
  avatar?: AccountAvatar;
}) {
  const t = await getT();
  const s = t.settings;
  return (
    <div className={styles.docket} data-settings>
      <div className={styles.docketHeader}>
        <span className={styles.docketForm}>{s.form}</span>
        <span className={styles.tag}>{s.tag}</span>
      </div>
      <LayoutPicker
        value={preferences.layout}
        title={s.sections.layout}
        hint={s.layout.hint}
        names={s.layout.names}
        status={s.status}
        action={action}
        initialStatus={initialStatus.layout}
      />
      <ThemePicker
        value={preferences.theme}
        title={s.sections.theme}
        labels={s.theme}
        status={s.status}
        action={action}
        initialStatus={initialStatus.theme}
      />
      <LanguagePicker
        value={preferences.locale}
        title={s.sections.language}
        labels={s.language}
        status={s.status}
        action={action}
        initialStatus={initialStatus.language}
      />
      <SoundToggle
        value={preferences.sound}
        title={s.sections.sound}
        hint={s.sound.hint}
        labels={s.sound}
        status={s.status}
        action={action}
        initialStatus={initialStatus.sound}
      />
      <AccountSection viewer={viewer} t={t} idPrefix={idPrefix} avatar={avatar} />
    </div>
  );
}

/**
 * `/settings` (#66, bible 14.3 "Settings"): the form-screen family head (red kicker, Stardos H1 with the
 * misregistration motif, one sentence) over the settings docket.
 */
export async function SettingsScreen({
  viewer,
  preferences,
  action,
  avatar,
}: {
  viewer: Viewer | null;
  preferences: Preferences;
  action: UpdatePreferences;
  avatar?: AccountAvatar;
}) {
  const t = await getT();
  return (
    <section className={styles.screen} aria-labelledby="settings-title">
      <div className={styles.column}>
        <div className={styles.kicker}>{t.settings.kicker}</div>
        <h1 id="settings-title" className={`${styles.title} ink-misregister`}>
          {t.settings.title}
        </h1>
        <p className={styles.lede}>{t.settings.lede}</p>
        <SettingsDocket viewer={viewer} preferences={preferences} action={action} avatar={avatar} />
      </div>
    </section>
  );
}
