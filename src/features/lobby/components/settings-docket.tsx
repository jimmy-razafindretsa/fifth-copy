import type { ReactNode } from "react";
import type { RaceSettings } from "@fifth-copy/protocol";
import { fill, type LobbyLabels } from "./lobby-labels";
import styles from "./lobby.module.css";

export type SettingsLabels = LobbyLabels["settings"];
export type SettingKey = keyof RaceSettings;
/** Per-key controls (#110): a key's control takes its value's place in the row; the label stays. */
export type SettingControls = Partial<Record<SettingKey, ReactNode>>;

type SettingRowSpec = {
  key: SettingKey;
  value: (settings: RaceSettings, labels: SettingsLabels) => string;
  /** The row shows only when this holds (a setting that means nothing in the current race). */
  when?: (settings: RaceSettings) => boolean;
};

const onOff = (on: boolean, labels: SettingsLabels) => (on ? labels.on : labels.off);

function difficulty({ difficulty: d }: RaceSettings, labels: SettingsLabels): string {
  if (d.level !== "custom") return labels.difficulty[d.level];
  return [
    labels.difficulty.custom,
    labels.wordLength[d.wordLength],
    d.rareLetters ? labels.rareLetters.on : labels.rareLetters.off,
    labels.punctuationDensity[d.punctuationDensity],
  ].join(" · ");
}

function timer({ timerS }: RaceSettings, labels: SettingsLabels): string {
  if (timerS === null) return labels.timer.none;
  const m = Math.floor(timerS / 60);
  const s = timerS % 60;
  return s === 0 ? fill(labels.timer.minutes, { m }) : fill(labels.timer.minutesSeconds, { m, s });
}

function bots({ bots }: RaceSettings, labels: SettingsLabels): string {
  if (bots.length === 0) return labels.noBots;
  const levels = bots.map((b) => labels.botLevel[b.level]).join(", ");
  return bots.length === 1
    ? fill(labels.bots.one, { levels })
    : fill(labels.bots.other, { n: bots.length, levels });
}

/**
 * Every `RaceSettings` field as one docket row, in the spec 8 order. Extension point: a new setting is
 * one entry here plus its catalog words (the `SETTING_ROWS` test checks every field has a row).
 */
export const SETTING_ROWS: ReadonlyArray<SettingRowSpec> = [
  { key: "language", value: (s, l) => l.language[s.language] },
  { key: "textType", value: (s, l) => l.textType[s.textType] },
  { key: "wordCount", value: (s, l) => fill(l.wordCount, { n: s.wordCount }) },
  {
    key: "accentEveryWord",
    value: (s, l) => (s.accentEveryWord ? l.accentEveryWord : l.off),
    when: (s) => s.language === "fr",
  },
  { key: "difficulty", value: difficulty },
  {
    key: "practiceLetters",
    value: (s, l) => (s.practiceLetters.length ? s.practiceLetters.join(" ") : l.noLetters),
  },
  { key: "includeNumbers", value: (s, l) => onOff(s.includeNumbers, l) },
  { key: "includeSymbols", value: (s, l) => onOff(s.includeSymbols, l) },
  { key: "includePunctuation", value: (s, l) => onOff(s.includePunctuation, l) },
  { key: "timerS", value: timer },
  { key: "errorMode", value: (s, l) => l.errorMode[s.errorMode] },
  {
    key: "backspace",
    value: (s, l) => onOff(s.backspace, l),
    when: (s) => s.errorMode === "continue",
  },
  { key: "bonuses", value: (s, l) => onOff(s.bonuses, l) },
  { key: "bots", value: bots },
  { key: "lobbyType", value: (s, l) => l.lobbyType[s.lobbyType] },
];

/** The rows the current settings show, label and value in words. */
export function settingRows(settings: RaceSettings, labels: SettingsLabels) {
  return SETTING_ROWS.filter((row) => row.when?.(settings) ?? true).map((row) => ({
    key: row.key,
    label: labels.labels[row.key],
    value: row.value(settings, labels),
  }));
}

/** Skeleton rows: the default race's row count (no accents row, the backspace row). */
const SKELETON_ROWS = 14;

/**
 * The read-only `FORM 5-L · RACE SETTINGS` docket (#498, bible 7.4, spec 8): the values every member
 * sees, following the host's changes live (the store replaces `settings` on every broadcast). Newsprint
 * docket, mono header plus Oswald tag, `120px | 1fr` rows with dashed separators; newsprint skeleton
 * blocks while `settings` is null. `controls` swaps a row's value for the host's control (#110).
 */
export function SettingsDocket({
  settings,
  labels,
  controls,
}: {
  settings: RaceSettings | null;
  labels: SettingsLabels;
  controls?: SettingControls;
}) {
  return (
    <section aria-label={labels.tag} className={`${styles.docket} ${styles.settings}`}>
      <div className={styles.docketHead}>
        <span className={styles.code}>{labels.name}</span>
        <span className={styles.tag}>{labels.tag}</span>
      </div>
      {settings ? (
        <dl className={styles.facts}>
          {settingRows(settings, labels).map((row) => (
            <div key={row.key} className={styles.row} data-setting={row.key}>
              <dt className={styles.label}>{row.label}</dt>
              <dd className={styles.value}>{controls?.[row.key] ?? row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className={styles.facts} aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className={styles.row} aria-hidden="true" data-skeleton>
              <span className={styles.block} />
              <span className={`${styles.block} ${styles.blockName}`} />
            </div>
          ))}
          <p className={styles.srOnly}>{labels.loading}</p>
        </div>
      )}
    </section>
  );
}
