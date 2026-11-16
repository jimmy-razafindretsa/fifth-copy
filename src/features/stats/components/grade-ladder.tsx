import type { Messages } from "@/i18n";
import { fill } from "@/i18n/format";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import { BOT_LEVELS } from "@fifth-copy/engine";
import { oneDecimal } from "../view/profile-figures";
import { rankIndex, type RankStep } from "../view/rank";
import styles from "./profile.module.css";

export type GradeLadderLabels = Messages["profile"]["ladder"] & {
  /** The catalogs' rank names in `BOT_LEVELS` order (the one list, #945). */
  ranks: readonly string[];
};

/** `OFFICIER` -> `Officier`, `HERO OF PAPERWORK` -> `Hero of paperwork`: the spoken form of a rank name. */
export function spokenRank(name: string, locale: Locale): string {
  const lower = name.toLocaleLowerCase(locale);
  return lower.charAt(0).toLocaleUpperCase(locale) + lower.slice(1);
}

/**
 * "Échelle des grades" (#337, bible 14.3 "Personnel file", reference `Profil.dc.html` lines 72-85): under
 * the hero's four figures, the head row (the label, the way to the next grade), the five grades as chips
 * in scale order (passed on ink, current on red, ahead outlined, the last one double-ruled while ahead)
 * and the red bar of the progress to the next grade. Draws a `RankStep` (`rankFor`, #945) and the mean
 * clean WPM (ADR 0016); holds no threshold. Server-rendered, no motion. A rank-up moment or a medal row
 * sits beside it later.
 */
export function GradeLadder({
  step,
  meanWpm,
  labels,
  locale,
  id,
}: {
  step: RankStep;
  meanWpm: number | null;
  labels: GradeLadderLabels;
  locale: Locale;
  id: string;
}) {
  const current = rankIndex(step.rank);
  const last = BOT_LEVELS.length - 1;
  const name = (index: number) => labels.ranks[index] ?? "";
  const nextName = step.nextRank === null ? null : name(rankIndex(step.nextRank));
  const line =
    step.nextAt === null || nextName === null
      ? labels.top
      : fill(labels.next, {
          wpm: oneDecimal(meanWpm ?? 0, locale),
          next: step.nextAt,
          rank: nextName,
        });
  const percent = Math.round(step.progress * 100);

  return (
    <div data-ladder="" data-grade={step.rank}>
      <div className={styles.ladderHead}>
        <span id={id}>{labels.label}</span>
        <span className={styles.ladderLine} data-ladder-line="">
          {line}
        </span>
      </div>
      <ol className={styles.grades} aria-labelledby={id}>
        {BOT_LEVELS.map((level, i) => {
          const state = i < current ? "passed" : i === current ? "current" : "ahead";
          return (
            <li
              key={level}
              data-grade={level}
              data-state={state}
              aria-current={state === "current" ? "true" : undefined}
              className={cn(
                styles.grade,
                state === "passed" && styles.gradePassed,
                state === "current" && styles.gradeCurrent,
                state === "ahead" && i === last && styles.gradeTop,
              )}
            >
              {state === "current" ? (
                <>
                  <span aria-hidden="true">{name(i)}</span>
                  <span className="sr-only">
                    {fill(labels.current, { rank: spokenRank(name(i), locale) })}
                  </span>
                </>
              ) : (
                name(i)
              )}
            </li>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-label={
          nextName === null
            ? labels.progressTop
            : fill(labels.progressName, { rank: spokenRank(nextName, locale) })
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={styles.gradeBar}
      >
        <div className={styles.gradeFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
