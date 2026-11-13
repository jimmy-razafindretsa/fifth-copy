import type { ReactNode } from "react";
import { DeviceTube, Stamp, Star } from "@/components/ui";
import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
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
import { ProfileStage } from "./profile-stage";
import styles from "./profile.module.css";

/** The catalog strings the screen draws (ADR 0010): the `profile` namespace and the few it borrows. */
export type ProfileLabels = Messages["profile"] & {
  honorific: string;
  unassigned: string;
  guestTag: string;
  prompt: string;
  signUp: string;
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
  };
}

export type ProfileLinks = { play: string; settings: string; signUp: string };

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
};

type Heading = "h1" | "h2" | "h3" | "h4";

/**
 * The Personnel file (#932, bible 14.3 "Personnel file", reference `Profil.dc.html`): one screen that
 * draws a `Profile` and the viewer's identity as an ordered list of sections, the hero (stage, file side,
 * four tubes), the ink band, the folder tabs, the service record and, under three races, the blank block.
 * Later cards add a section each. Server-rendered; the stage is the one client leaf.
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
}: ProfileScreenProps) {
  const Title = `h${level}` as Heading;
  const Section = `h${level + 1}` as Heading;
  const number = fileNumber(viewer?.name);
  const name = viewer ? fill(labels.honorific, { name: viewer.name }) : labels.unassigned;
  const languages = racedLanguages(profile);
  const races = profile.service.races;
  const state = races === 0 ? "blank" : races < BLANK_BELOW ? "almost" : "populated";
  const serviceLine = [
    since ? fill(labels.since, { date: serviceDate(since, locale) }) : null,
    languages ? labels.languages[languages] : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.screen} data-profile-state={state}>
      <section className={styles.hero} aria-labelledby="profile-name">
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
            <Title id="profile-name" className={styles.name}>
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
        </div>
      </section>

      <div className={styles.bandBox} aria-hidden="true" data-band="">
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
        <nav aria-label={labels.tabs.label} className={styles.tabs}>
          <a href="#profile-name" aria-current="page" className={cn(styles.tab, styles.tabCurrent)}>
            {labels.tabs.stats}
          </a>
          <a href={links.settings} className={styles.tab}>
            {labels.tabs.settings}
          </a>
        </nav>

        <div className={styles.sections}>
          <section aria-labelledby="profile-service">
            <div className={styles.head}>
              <div>
                <p className={styles.kicker}>{labels.service.kicker}</p>
                <Section id="profile-service" className={styles.h2}>
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

          {races < BLANK_BELOW ? (
            <section className={styles.blank} aria-labelledby="profile-blank" data-blank="">
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
              <Section id="profile-blank" className={cn(styles.h2, styles.blankTitle)}>
                {races === 0 ? labels.blank.nothing : labels.blank.almostNothing}
              </Section>
              <p className={styles.blankBody}>{labels.blank.body}</p>
              <a href={links.play} className={styles.stampLink}>
                {labels.blank.cta}
              </a>
            </section>
          ) : null}
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
