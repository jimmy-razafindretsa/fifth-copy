import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { STATS_TIME_ZONE } from "@/lib/time";
import type { MedalShelf } from "../view/medals";
import styles from "./medals.module.css";

export type MedalsLabels = Messages["profile"]["medals"];

type Heading = "h2" | "h3" | "h4";
const below: Record<Heading, "h3" | "h4" | "h5"> = { h2: "h3", h3: "h4", h4: "h5" };

/** The pinning day, short and upper case like a docket stamp (`12 NOV. 2026` / `NOV 12, 2026`). */
function pinnedOn(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: STATS_TIME_ZONE,
  })
    .format(at)
    .toUpperCase();
}

/** One stripe of the pentagonal ribbon, clipped to its outline: `x` .. `x + w` (bible 13). */
function stripe(x: number, w: number): string {
  // the ribbon is 12..44 wide, square down to y 22, then a point at (28, 30)
  const edge = (at: number) => 22 + (8 * (at <= 28 ? at - 12 : 44 - at)) / 16;
  return `${x},0 ${x + w},0 ${x + w},${edge(x + w)} ${x},${edge(x)}`;
}

const star = (cx: number, cy: number, outer: number, inner: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

/**
 * The enamel pin (bible 13 "Chest pin", flat for a UI page): the pentagonal ribbon (banner red with
 * gold and violet stripes), the gold clasp and ring, the gold disc with its rim, the raised gold star
 * with the red enamel star inside and the gold boss. Decoration: the card's name says which pin.
 */
export function PinMark() {
  return (
    <svg className={styles.pin} viewBox="0 0 56 72" aria-hidden="true" focusable="false">
      <polygon className={styles.ribbon} points="12,0 44,0 44,22 28,30 12,22" />
      <polygon className={styles.gold} points={stripe(16, 3)} />
      <polygon className={styles.violet} points={stripe(26, 4)} />
      <polygon className={styles.gold} points={stripe(37, 3)} />
      <polygon className={styles.outline} points="12,0 44,0 44,22 28,30 12,22" />
      <circle className={styles.ring} cx="28" cy="34" r="3" />
      <circle className={styles.disc} cx="28" cy="54" r="16" />
      <circle className={styles.rim} cx="28" cy="54" r="13" />
      <polygon className={styles.disc} points={star(28, 54, 11, 4.4)} />
      <polygon className={styles.enamel} points={star(28, 54, 7.5, 3)} />
      <circle className={styles.disc} cx="28" cy="54" r="2.2" />
    </svg>
  );
}

/**
 * Medals on the Personnel file (#999 C36, C40; spec 13.4, bible 13, 7.6, 14.3 "Medals"): the whole pin
 * catalogue as 7.6 item cards, each a pin (`PinMark`), its code, its in-world name and description:
 * earned (pinned on its day), new (the red `NEW` tag, pinned in the last `MEDAL_NEW_DAYS`), locked (the
 * dashed violet rule, the pin greyed, `🔒︎ LOCKED` and the requirement in violet). With no pin the
 * section opens on one sentence saying how the first is earned. Server-rendered, no state, no motion.
 */
export function Medals({
  shelf,
  labels,
  locale,
  id,
  heading: Section,
}: {
  shelf: MedalShelf;
  labels: MedalsLabels;
  locale: Locale;
  id: string;
  heading: Heading;
}) {
  const Name = below[Section];
  const total = shelf.medals.length;
  return (
    <section
      aria-labelledby={id}
      data-section="medals"
      data-medals={shelf.earned === 0 ? "none" : "some"}
    >
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>{labels.kicker}</p>
          <Section id={id} className={styles.h2}>
            {labels.title}
          </Section>
        </div>
        <div className={styles.side}>
          <p className={styles.intro}>{labels.intro}</p>
          <p className={styles.count} data-medals-count="">
            {fill(labels.count, { n: shelf.earned, total })}
          </p>
        </div>
      </div>
      {shelf.earned === 0 ? (
        <p className={styles.none} data-medals-none="">
          {labels.none}
        </p>
      ) : null}
      <ul className={styles.cards} aria-label={labels.list}>
        {shelf.medals.map((medal) => {
          const pin = labels.pins[medal.id];
          return (
            <li key={medal.id} className={styles.card} data-pin={medal.id} data-state={medal.state}>
              <div className={styles.top}>
                <span className={styles.code}>{medal.code}</span>
                {medal.state === "new" ? (
                  <span className={styles.newTag} data-new="">
                    {labels.new}
                  </span>
                ) : null}
              </div>
              <div className={styles.body}>
                <PinMark />
                <div className={styles.text}>
                  <Name className={styles.name}>{pin.name}</Name>
                  <p className={styles.description}>{pin.description}</p>
                </div>
              </div>
              {medal.awardedAt === null ? (
                <p className={styles.locked}>
                  <span aria-hidden="true">{"\u{1F512}︎ "}</span>
                  {labels.locked}
                </p>
              ) : (
                <p className={styles.sub}>
                  {fill(labels.awarded, { date: pinnedOn(medal.awardedAt, locale) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
