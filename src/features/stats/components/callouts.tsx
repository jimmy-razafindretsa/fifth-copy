import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import type { Callout } from "../callouts/rule";
import styles from "./callouts.module.css";
import profile from "./profile.module.css";

export type CalloutsLabels = Messages["profile"]["callouts"];

/** One callout's sentence from the C40 templates: `Your ç is 30% faster than last week.` */
export function calloutSentence(callout: Callout, labels: CalloutsLabels): string {
  return fill(labels[callout.kind], { key: callout.char, pct: callout.pct });
}

/**
 * "Bulletin de la semaine" / "Weekly bulletin" (#331, #999 C48, C49; spec 13.2; bible 14.3, extending
 * the Dawn report's order of the day, #867): the section head, then one paper docket listing each
 * callout as a row: the key in the ranking's portrait cell, then its one sentence. Absent without a
 * callout. Server-rendered, nothing moves, no colour carries meaning (the sentence says it all).
 */
export function Callouts({
  callouts,
  labels,
  locale,
  id,
  heading: Heading,
}: {
  callouts: readonly Callout[];
  labels: CalloutsLabels;
  locale: Locale;
  id: string;
  heading: "h2" | "h3" | "h4";
}) {
  if (callouts.length === 0) return null;
  return (
    <section aria-labelledby={id} data-section="callouts">
      <div className={profile.head}>
        <div>
          <p className={profile.kicker}>{labels.kicker}</p>
          <Heading id={id} className={profile.h2}>
            {labels.title}
          </Heading>
        </div>
        <p className={profile.intro}>{labels.intro}</p>
      </div>
      <ul aria-label={labels.list} className={styles.docket} data-callouts="">
        {callouts.map((c) => (
          <li key={c.char} className={styles.row} data-callout={c.kind} data-callout-key={c.char}>
            <span className={styles.key} aria-hidden="true">
              {c.char.toLocaleUpperCase(locale)}
            </span>
            <span className={styles.sentence}>{calloutSentence(c, labels)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
