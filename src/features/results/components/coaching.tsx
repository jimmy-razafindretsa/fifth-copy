import Link from "next/link";
import { fill } from "@/i18n/format";
import type { MissedKey } from "../view/keys";
import type { PersonalLabels } from "../view/report-labels";
import { GUIDE_HREF, type Coaching, type Tip } from "../view/tip";
import styles from "./coaching.module.css";

/** A key as the card names it: the character, or `SPACE` / `ESPACE` for a space. */
export function keyName(char: string, labels: PersonalLabels): string {
  return char === " " ? labels.keys.space : char;
}

/** The tip's one sentence, its key named as the list names it. */
export function tipSentence(tip: Tip, labels: PersonalLabels): string {
  const template = labels.tip[tip.id];
  return "char" in tip ? fill(template, { key: keyName(tip.char, labels), n: tip.count }) : template;
}

/**
 * The personal card's last two sections (#867, spec 11.3 "errors by key", epic #298 "one concrete thing
 * to improve"; bible 14.4 "Errors by key", 7.4, 2, 3), presentational: the keys the viewer missed in
 * this race, most missed first, each in the ranking's 32px portrait-cell square with its `× n` (`NONE`
 * with no error, `NO TRACE ON FILE` with no trace); then the one tip under the ink tag `ORDER OF THE DAY`,
 * one sentence, the `special` tip followed by the guide link. The keys and the tip come from the view
 * (`coachingFrom`: `missedKeys`, `pickTip`); nothing is decided here. No gold, no motion.
 */
export function CoachingSections({
  coaching,
  labels,
}: {
  coaching: Coaching;
  labels: PersonalLabels;
}) {
  return (
    <>
      <div className={styles.section} data-section="keys">
        <h3 className={styles.title}>{labels.keys.title}</h3>
        {coaching.keys === null ? (
          <p className={styles.none} data-no-trace>
            {labels.graph.noTrace}
          </p>
        ) : coaching.keys.length === 0 ? (
          <p className={styles.none} data-no-error>
            {labels.keys.none}
          </p>
        ) : (
          <KeyList keys={coaching.keys} labels={labels} />
        )}
      </div>
      <div className={styles.section} data-section="tip" data-tip={coaching.tip.id}>
        <h3 className={styles.tag}>{labels.tip.tag}</h3>
        <p className={styles.sentence} data-field="tip">
          {tipSentence(coaching.tip, labels)}
        </p>
        {coaching.tip.id === "special" && (
          <Link href={GUIDE_HREF} className={styles.guide} data-guide>
            {labels.tip.guide}
          </Link>
        )}
      </div>
    </>
  );
}

function KeyList({ keys, labels }: { keys: readonly MissedKey[]; labels: PersonalLabels }) {
  return (
    <ol className={styles.keys}>
      {keys.map((k) => (
        <li key={k.char} className={styles.key} data-key={k.char}>
          <span className={k.char === " " ? styles.named : styles.square} data-field="key">
            {keyName(k.char, labels)}
          </span>
          <span className={styles.count} data-field="count">
            {fill(labels.count, { n: k.count })}
          </span>
        </li>
      ))}
    </ol>
  );
}
