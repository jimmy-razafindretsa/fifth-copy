import { Fragment, type ReactNode, Suspense } from "react";
import { DeviceTube, Stamp, Star } from "@/components/ui";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import type { Census } from "../view/census";
import type { KeyFile } from "../view/key-file";
import type { MedalShelf } from "../view/medals";
import { type KeyboardLayoutKeys, keyboardMapOf } from "../view/keyboard-map";
import { CURVE_MIN_RACES, CURVE_RACES, TREND_MIN_POINTS } from "../view/performance-curve";
import type { Profile } from "../view/profile";
import {
  BLANK_BELOW,
  BLANK_TUBE,
  type Figure,
  figures,
  fileNumber,
  NBSP,
  racedLanguages,
  serviceDate,
  tubes,
} from "../view/profile-figures";
import { rankFor } from "../view/rank";
import { AttendanceRegister } from "./attendance-register";
import { CensusSlot } from "./census-slot";
import { GradeLadder } from "./grade-ladder";
import { KeyInventory } from "./key-inventory";
import { KeyProgress } from "./key-progress";
import { KeySheetSection } from "./key-sheet-section";
import { KeyboardMap } from "./keyboard-map";
import { Medals } from "./medals";
import { PerformanceCurve } from "./performance-curve";
import { ArchiveSection, StreaksDocket } from "./profile-records";
import { ProfileStage } from "./profile-stage";
import { SuspectPairs } from "./suspect-pairs";
import styles from "./profile.module.css";

/** The catalog strings the screen draws (ADR 0010): the `profile` namespace and the few it borrows. */
export type ProfileLabels = Messages["profile"] & {
  honorific: string;
  unassigned: string;
  guestTag: string;
  prompt: string;
  signUp: string;
  /** The catalogs' rank names (`landing.clerk.ranks`, #945), in `BOT_LEVELS` order. */
  ranks: readonly string[];
  /** The keyboard layouts' settings labels (`settings.layout.names`), for the keyboard map (#324). */
  layoutNames: Readonly<Record<string, string>>;
};

/** Picks the screen's strings from a catalog. */
export function profileLabels(t: Messages): ProfileLabels {
  return {
    ...t.profile,
    honorific: t.header.honorific,
    unassigned: t.landing.clerk.unassigned,
    guestTag: t.auth.account.guestTag,
    prompt: t.results.actions.prompt,
    signUp: t.results.actions.signup,
    ranks: t.landing.clerk.ranks,
    layoutNames: t.settings.layout.names,
  };
}

export type ProfileLinks = { play: string; settings: string; signUp: string };

/**
 * The keyboard layouts the keyboard map (#324) draws `KeyFile.byChar` on: identity's layout module as the
 * route hands it in (ids in the settings order, each its number row and letter rows) and the one to
 * start on (the viewer's saved layout, else the locale's default).
 */
export type ProfileKeyboard = {
  initial: string;
  layouts: readonly { id: string; keys: KeyboardLayoutKeys }[];
};

export type ProfileScreenProps = {
  profile: Profile;
  /** The viewer `getViewer()` resolved, or null (a cookie that no longer resolves: the blank file). */
  viewer: { name: string; isGuest: boolean } | null;
  /** The day the viewer's row was created (identity `getServiceStart`), or null. */
  since: Date | null;
  stage: { clerkSrc: string | null; picture: ReactNode; still?: boolean };
  labels: ProfileLabels;
  locale: Locale;
  links: ProfileLinks;
  /** The name's heading level: 1 on the page, lower in a `/design` specimen; sections are one below. */
  level?: 1 | 2 | 3;
  /** Prefix of the heading ids (`profile`): `/design` shows several files on one page. */
  idPrefix?: string;
  /**
   * The typist census read for this viewer (#967, `getCensus`; a fixture on `/design`). Called from 3
   * counted races; its section streams in its own `Suspense` boundary after the clean streaks.
   */
  census?: () => Promise<Census | null>;
  /**
   * The viewer's key file (#961, `getKeyFile`; a fixture on `/design`): from 3 counted races and one day
   * of key data it draws "Progression par touche" (#962), "Fiche par touche" (#963) and "Vitesse,
   * frappes et fautes" (#964); its letter pairs fill "Combinaisons suspectes" (#965) beside the
   * clean streaks. Absent: no section.
   */
  keyFile?: KeyFile;
  /**
   * The keyboard layouts for "Carte du clavier" (#324): with the key file (3 counted races, one day of
   * key data) the section draws after the key inventory. Absent: no section.
   */
  keyboard?: ProfileKeyboard;
  /**
   * The viewer's enamel pins (#999 C36, `getMedals`): the whole catalogue, earned, new or locked, on
   * every file with a viewer (a blank file too: none earned yet). Absent or null: no section.
   */
  medals?: MedalShelf | null;
};

type Heading = "h1" | "h2" | "h3" | "h4";

/**
 * The column's sections in the reference's order (`Profil.dc.html` top to bottom, bible 14.3; #970),
 * under the hero, the band and the folder tabs: the one list that places a section. The blank block
 * (under 3 counted races) takes the reference's place, right after the service record; the clean
 * streaks share their row with the suspect pairs (`Séries sans faute` | `Combinaisons suspectes`).
 * A section absent from a file (no data yet) leaves no placeholder.
 */
export const PROFILE_SECTIONS = [
  "service",
  "blank",
  "dockets",
  "census",
  "keyProgress",
  "curve",
  "keySheet",
  "keyInventory",
  "keyboardMap",
  "attendance",
  "medals",
  "archive",
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/**
 * The Personnel file (#932, bible 14.3 "Personnel file", reference `Profil.dc.html`): one screen that
 * draws a `Profile` and the viewer's identity: the hero (stage, file side, four tubes, the grade ladder
 * of #337), the ink band, the folder tabs, then the sections of `PROFILE_SECTIONS` in that order (#970):
 * the service record, under three races the blank block, from three races the clean streaks (#936)
 * beside the suspect letter pairs (#965), the typist census (#967), the progress by key (#962), the
 * output curve (#933), the key sheet (#963), the key inventory (#964), the keyboard map (#324), the
 * attendance register (#330), the enamel pins (#999 C36) and the race archives (#936). Each section carries its `data-section`
 * marker. Server-rendered; the stage and the interactive plots are client leaves.
 */
export function ProfileScreen({
  profile,
  viewer,
  since,
  stage,
  labels,
  locale,
  links,
  level = 1,
  idPrefix = "profile",
  census,
  keyFile,
  keyboard,
  medals,
}: ProfileScreenProps) {
  const ids = {
    name: `${idPrefix}-name`,
    service: `${idPrefix}-service`,
    blank: `${idPrefix}-blank`,
    curve: `${idPrefix}-curve`,
    streaks: `${idPrefix}-streaks`,
    archive: `${idPrefix}-archive`,
    ladder: `${idPrefix}-ladder`,
    census: `${idPrefix}-census`,
    attendance: `${idPrefix}-attendance`,
    keyProgress: `${idPrefix}-key-progress`,
    keySheet: `${idPrefix}-key-sheet`,
    keyInventory: `${idPrefix}-key-inventory`,
    suspectPairs: `${idPrefix}-suspect-pairs`,
    keyboardMap: `${idPrefix}-keyboard-map`,
    medals: `${idPrefix}-medals`,
  };
  const Title = `h${level}` as Heading;
  const Section = `h${level + 1}` as Heading;
  const number = fileNumber(viewer?.name);
  const name = viewer ? fill(labels.honorific, { name: viewer.name }) : labels.unassigned;
  const languages = racedLanguages(profile);
  const races = profile.service.races;
  // the curve's points: the latest 40, only what the client leaf draws
  const curvePoints = profile.progress.series
    .slice(-CURVE_RACES)
    .map((p) => ({ cleanWpm: p.cleanWpm, accuracy: p.accuracy }));
  const state = races === 0 ? "blank" : races < BLANK_BELOW ? "almost" : "populated";
  const serviceLine = [
    since ? fill(labels.since, { date: serviceDate(since, locale) }) : null,
    languages ? labels.languages[languages] : null,
  ]
    .filter(Boolean)
    .join(" ");
  const counted = races >= BLANK_BELOW;
  const keyed = keyFile && counted && keyFile.days.length > 0 ? keyFile : null;

  // every section of the column, by its place in PROFILE_SECTIONS; null = not on this file
  const sections: Record<ProfileSection, ReactNode> = {
    service: (
      <section aria-labelledby={ids.service} data-section="service">
        <div className={styles.head}>
          <div>
            <p className={styles.kicker}>{labels.service.kicker}</p>
            <Section id={ids.service} className={styles.h2}>
              {labels.service.title}
            </Section>
          </div>
          <p className={styles.intro}>{labels.service.intro}</p>
        </div>
        <dl className={styles.grid}>
          {figures(profile.service, locale).map((figure) => (
            <FigureCell key={figure.key} figure={figure} labels={labels.service} />
          ))}
        </dl>
      </section>
    ),
    blank: counted ? null : (
      <section
        className={styles.blank}
        aria-labelledby={ids.blank}
        data-section="blank"
        data-blank=""
      >
        <Stamp
          still
          role={null}
          tone="red"
          size="lg"
          rotation={-6}
          lines={[labels.blank.stamp[0], labels.blank.stamp[1]]}
          className={styles.blankStamp}
        />
        <p className={styles.kicker}>{labels.blank.kicker}</p>
        <Section id={ids.blank} className={cn(styles.h2, styles.blankTitle)}>
          {races === 0 ? labels.blank.nothing : labels.blank.almostNothing}
        </Section>
        <p className={styles.blankBody}>{labels.blank.body}</p>
        <a href={links.play} className={styles.stampLink}>
          {labels.blank.cta}
        </a>
      </section>
    ),
    dockets: counted ? (
      <div className={styles.pair} data-docket-pair="">
        <StreaksDocket
          streaks={profile.streaks}
          labels={labels.streaks}
          locale={locale}
          id={ids.streaks}
          heading={Section}
        />
        {keyFile && keyFile.pairs.length > 0 ? (
          <SuspectPairs
            pairs={keyFile.pairs}
            labels={labels.suspectPairs}
            locale={locale}
            id={ids.suspectPairs}
            heading={Section as "h2" | "h3" | "h4"}
          />
        ) : null}
      </div>
    ) : null,
    census:
      census && counted ? (
        <Suspense fallback={null}>
          <CensusSlot
            read={census}
            labels={labels.census}
            locale={locale}
            id={ids.census}
            heading={Section as "h2" | "h3" | "h4"}
          />
        </Suspense>
      ) : null,
    keyProgress: keyed ? (
      <KeyProgress
        keyFile={keyed}
        labels={labels.keyProgress}
        locale={locale}
        id={ids.keyProgress}
        heading={Section as "h2" | "h3" | "h4"}
      />
    ) : null,
    curve:
      curvePoints.length >= CURVE_MIN_RACES ? (
        <section aria-labelledby={ids.curve} data-section="curve">
          <div className={styles.head}>
            <div>
              <p className={styles.kicker}>{labels.curve.kicker}</p>
              <Section id={ids.curve} className={styles.h2}>
                {labels.curve.title}
              </Section>
            </div>
            <p className={styles.intro}>
              {fill(labels.curve.intro, { count: curvePoints.length })}
              {curvePoints.length >= TREND_MIN_POINTS ? ` ${labels.curve.introTrend}` : null}
            </p>
          </div>
          <PerformanceCurve points={curvePoints} labels={labels.curve} locale={locale} />
        </section>
      ) : null,
    keySheet: keyed ? (
      <KeySheetSection
        keyFile={keyed}
        labels={labels.keySheet}
        locale={locale}
        id={ids.keySheet}
        heading={Section as "h2" | "h3" | "h4"}
      />
    ) : null,
    keyInventory: keyed ? (
      <KeyInventory
        keyFile={keyed}
        labels={labels.keyInventory}
        locale={locale}
        id={ids.keyInventory}
        heading={Section as "h2" | "h3" | "h4"}
      />
    ) : null,
    keyboardMap:
      keyed && keyboard ? (
        <KeyboardMap
          layouts={keyboard.layouts.map((l) => ({
            id: l.id,
            name: labels.layoutNames[l.id] ?? l.id,
            map: keyboardMapOf(keyed.byChar, l.keys),
          }))}
          initial={keyboard.initial}
          labels={labels.keyboardMap}
          locale={locale}
          id={ids.keyboardMap}
          heading={Section as "h2" | "h3" | "h4"}
        />
      ) : null,
    attendance: counted ? (
      <AttendanceRegister
        attendance={profile.attendance}
        labels={labels.attendance}
        locale={locale}
        id={ids.attendance}
        heading={Section as "h2" | "h3" | "h4"}
      />
    ) : null,
    medals: medals ? (
      <Medals
        shelf={medals}
        labels={labels.medals}
        locale={locale}
        id={ids.medals}
        heading={Section as "h2" | "h3" | "h4"}
      />
    ) : null,
    archive:
      counted && profile.archive.length > 0 ? (
        <ArchiveSection
          archive={profile.archive}
          labels={labels.archive}
          locale={locale}
          id={ids.archive}
          heading={Section}
        />
      ) : null,
  };

  return (
    <div className={styles.screen} data-profile-state={state}>
      <section className={styles.hero} aria-labelledby={ids.name} data-section="hero">
        <div className={styles.stage}>
          <p className={styles.stageLabel}>{labels.stage.label}</p>
          <Star size={46} tone="red" rotate={12} at={{ top: 40, right: 42, zIndex: 2 }} />
          <Star size={24} tone="gold" rotate={-8} at={{ top: 96, right: 92, zIndex: 2 }} />
          <Star size={52} tone="faintInk" rotate={-14} at={{ bottom: 26, left: 30, zIndex: 0 }} />
          <ProfileStage
            clerkSrc={stage.clerkSrc}
            title={labels.stage.clerkTitle}
            picture={stage.picture}
            still={stage.still}
          />
        </div>
        <div className={styles.file}>
          {viewer && !viewer.isGuest ? (
            <Stamp
              still
              role={null}
              tone="red"
              size="sm"
              rotation={6}
              lines={[labels.verified[0], labels.verified[1]]}
              className={styles.verified}
            />
          ) : null}
          {viewer?.isGuest ? (
            <span className={styles.guestTag} data-guest-tag="">
              {labels.guestTag}
            </span>
          ) : null}
          <div>
            <p className={styles.kicker}>
              {number ? fill(labels.kickerNumbered, { number }) : labels.kicker}
            </p>
            <Title id={ids.name} className={styles.name}>
              {`${name}.`}
            </Title>
            {serviceLine ? <p className={styles.serviceLine}>{serviceLine}</p> : null}
          </div>
          {viewer?.isGuest ? (
            <p className={styles.prompt} data-prompt="">
              <span>{labels.prompt}</span>
              <a href={links.signUp} className={styles.secondary}>
                {labels.signUp}
              </a>
            </p>
          ) : null}
          <div role="group" aria-label={labels.tubes.label} className={styles.tubes}>
            {tubes(profile.service, locale).map((tube) => (
              <DeviceTube
                key={tube.key}
                value={tube.value}
                tag={labels.tubes[tube.key]}
                spoken={`${labels.tubes[tube.key]}: ${
                  tube.value === BLANK_TUBE ? labels.tubes.none : tube.value
                }`}
              />
            ))}
          </div>
          <GradeLadder
            step={rankFor(profile.service.meanWpm)}
            meanWpm={profile.service.meanWpm}
            labels={{ ...labels.ladder, ranks: labels.ranks }}
            locale={locale}
            id={ids.ladder}
          />
        </div>
      </section>

      <div className={styles.bandBox} aria-hidden="true" data-band="" data-section="band">
        <p className={styles.band}>
          {[
            labels.band.confidential,
            number ? fill(labels.band.fileNumbered, { number }) : labels.band.file,
            labels.band.filed,
            labels.band.notes,
            labels.band.confidential,
            number ? fill(labels.band.fileNumbered, { number }) : labels.band.file,
          ].map((part, i) => (
            <span key={i}>
              {i > 0 ? <span className={styles.bandStar}> ★ </span> : null}
              {part}
            </span>
          ))}
        </p>
      </div>

      <div className={styles.column}>
        <nav aria-label={labels.tabs.label} className={styles.tabs} data-section="tabs">
          <a
            href={`#${ids.name}`}
            aria-current="page"
            className={cn(styles.tab, styles.tabCurrent)}
          >
            {labels.tabs.stats}
          </a>
          <a href={links.settings} className={styles.tab}>
            {labels.tabs.settings}
          </a>
        </nav>

        <div className={styles.sections}>
          {PROFILE_SECTIONS.map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

const UNIT_KEY = {
  wpm: "wpm",
  firstPlace: "firstPlace",
  top3: "top3",
} as const;

/** One 7.4 figure cell: the label over the figure, its unit muted after a no-break space. */
function FigureCell({ figure, labels }: { figure: Figure; labels: ProfileLabels["service"] }) {
  const unit =
    figure.unit === null ? null : figure.unit === "percent" ? "%" : labels[UNIT_KEY[figure.unit]];
  return (
    <div className={styles.cell} data-figure={figure.key}>
      <dt className={styles.cellLabel}>{labels[figure.key]}</dt>
      <dd className={cn(styles.figure, figure.red && styles.figureRed)}>
        {figure.value}
        {unit ? (
          <>
            {NBSP}
            <span className={styles.unit}>{unit}</span>
          </>
        ) : null}
      </dd>
    </div>
  );
}
