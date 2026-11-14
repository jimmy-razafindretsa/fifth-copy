import { type ReactNode, Suspense } from "react";
import { Star } from "@/components/ui";
import { rankFor, rankIndex, type RankStep } from "@/features/stats";
import { fill } from "@/i18n/format";
import type { Messages } from "@/i18n/en";
import styles from "./home.module.css";

export type PlayerDocketLabels = Messages["home"]["docket"] & {
  /** The catalogs' rank list, in `BOT_LEVELS` order (the last is HERO OF PAPERWORK). */
  ranks: readonly string[];
};

export type DocketPlayer = {
  name: string;
  /** Approved avatar, else the default portrait (server-rendered, decorative). */
  picture: ReactNode;
  guest: boolean;
};

type Props = {
  player: DocketPlayer;
  href: string;
  labels: PlayerDocketLabels;
  /** The star cell (#943 C19), streamed by the route. */
  stars?: ReactNode;
};

/**
 * The player docket (#945; bible "Home menu", 7.4): portrait, name, the rank tag and the way to the next
 * rank (`rankFor` of the mean clean WPM, ADR 0016), then the star cell. A guest shows the GUEST tag and
 * no progress. An account's docket streams in its own `Suspense` boundary; a failing read renders none.
 */
export function PlayerDocket({ load, ...props }: Props & { load: () => Promise<number | null> }) {
  if (props.player.guest) return <PlayerDocketView {...props} step={null} meanWpm={null} />;
  return (
    <Suspense fallback={null}>
      <PlayerDocketLoaded load={load} {...props} />
    </Suspense>
  );
}

export async function PlayerDocketLoaded({
  load,
  ...props
}: Props & { load: () => Promise<number | null> }) {
  let meanWpm: number | null;
  try {
    meanWpm = await load();
  } catch {
    return null;
  }
  return <PlayerDocketView {...props} step={rankFor(meanWpm)} meanWpm={meanWpm} />;
}

export function PlayerDocketView({
  player,
  href,
  labels,
  stars,
  step,
  meanWpm,
}: Props & { step: RankStep | null; meanWpm: number | null }) {
  const rankName = (level: RankStep["rank"]) => labels.ranks[rankIndex(level)] ?? level;
  return (
    <div className={styles.docket} data-player-docket={player.guest ? "guest" : "account"}>
      <a
        href={href}
        className={styles.docketLink}
        aria-label={fill(labels.fileName, { name: player.name })}
      >
        <span className={styles.docketPicture} aria-hidden="true">
          {player.picture}
        </span>
        <span className={styles.docketBody}>
          <span className={styles.docketTop}>
            <span className={styles.docketName}>{player.name}</span>
            <span className={styles.rankTag} data-rank={step?.rank ?? "guest"}>
              {step ? rankName(step.rank) : labels.guest}
            </span>
          </span>
          {step && step.nextRank !== null && step.nextAt !== null ? (
            <>
              <span
                className={styles.rankBar}
                role="progressbar"
                aria-label={fill(labels.progressName, { rank: rankName(step.nextRank) })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(step.progress * 100)}
              >
                <span className={styles.rankFill} style={{ width: `${step.progress * 100}%` }} />
              </span>
              <span className={styles.rankLine} data-rank-line>
                {fill(labels.line, {
                  wpm: Math.round(meanWpm ?? 0),
                  next: step.nextAt,
                  rank: rankName(step.nextRank),
                })}
              </span>
            </>
          ) : null}
        </span>
      </a>
      {stars}
    </div>
  );
}

export type StarLabels = Messages["home"]["docket"]["stars"];

/** The star cell (#943 C19): a decorative gold star and the total, named `<n> stars`. Streams alone. */
export function StarCell(props: { load: () => Promise<number | null>; labels: StarLabels }) {
  return (
    <Suspense fallback={null}>
      <StarCellLoaded {...props} />
    </Suspense>
  );
}

export async function StarCellLoaded({
  load,
  labels,
}: {
  load: () => Promise<number | null>;
  labels: StarLabels;
}) {
  const stars = await load().catch(() => null);
  return stars === null ? null : <StarCellView stars={stars} labels={labels} />;
}

export function StarCellView({ stars, labels }: { stars: number; labels: StarLabels }) {
  return (
    <span
      className={styles.starCell}
      role="img"
      aria-label={fill(stars === 1 ? labels.one : labels.other, { n: stars })}
      data-stars={stars}
    >
      <Star size={16} tone="gold" rotate={-8} />
      <span aria-hidden="true">{stars}</span>
    </span>
  );
}
