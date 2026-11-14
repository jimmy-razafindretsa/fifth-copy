import { type ReactNode, Suspense } from "react";
import { Star } from "@/components/ui";
import { fill } from "@/i18n/format";
import type { Messages } from "@/i18n/en";
import styles from "./home.module.css";

export type PlayerDocketLabels = Messages["home"]["docket"];

/**
 * The viewer's rank as the route resolves it from the stats feature's `rankFor` (names already in the
 * viewer's language; the landing never imports the stats index, ADR 0021): the rank, and the way to the
 * next one (`null` at the top).
 */
export type DocketRank = {
  /** `BOT_LEVELS` id, for `data-rank`. */
  level: string;
  name: string;
  meanWpm: number;
  next: { name: string; at: number; progress: number } | null;
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
export function PlayerDocket({ load, ...props }: Props & { load: () => Promise<DocketRank> }) {
  if (props.player.guest) return <PlayerDocketView {...props} rank={null} />;
  return (
    <Suspense fallback={null}>
      <PlayerDocketLoaded load={load} {...props} />
    </Suspense>
  );
}

export async function PlayerDocketLoaded({
  load,
  ...props
}: Props & { load: () => Promise<DocketRank> }) {
  let rank: DocketRank;
  try {
    rank = await load();
  } catch {
    return null;
  }
  return <PlayerDocketView {...props} rank={rank} />;
}

export function PlayerDocketView({
  player,
  href,
  labels,
  stars,
  rank,
}: Props & { rank: DocketRank | null }) {
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
            <span className={styles.rankTag} data-rank={rank?.level ?? "guest"}>
              {rank ? rank.name : labels.guest}
            </span>
          </span>
          {rank?.next ? (
            <>
              <span
                className={styles.rankBar}
                role="progressbar"
                aria-label={fill(labels.progressName, { rank: rank.next.name })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(rank.next.progress * 100)}
              >
                <span
                  className={styles.rankFill}
                  style={{ width: `${rank.next.progress * 100}%` }}
                />
              </span>
              <span className={styles.rankLine} data-rank-line>
                {fill(labels.line, {
                  wpm: Math.round(rank.meanWpm),
                  next: rank.next.at,
                  rank: rank.next.name,
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
      <Star size={16} tone="gold" rotate={-8} className={styles.inlineStar} />
      <span aria-hidden="true">{stars}</span>
    </span>
  );
}
