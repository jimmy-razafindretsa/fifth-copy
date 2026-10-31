import type { CountdownLabels } from "../components/countdown";
import type { StampRowLabels } from "../components/stamp-row";
import type { TelexLabels } from "../components/telex-strip";
import type { FinishLabels } from "../view/standings";
import type {
  AbandonLabels,
  NixieLabels,
  RaceCardLabels,
  RaceNoticeLabels,
  SabotageTrayLabels,
} from "../view/hud-labels";

/**
 * The seat view's copy (#561 C6): the `race` namespace of both catalogs, one language per page (ADR
 * 0010). The HUD parts take the label types of their components, so a catalog that drifts from them
 * fails the type-check.
 */
export type RaceSeatLabels = {
  /** The page's heading, a kicker: `SEAT VIEW` until the welcome, then `SEAT VIEW · DESK {n}`. */
  kicker: { seat: string; desk: string };
  telex: TelexLabels;
  /** The 3-2-1 countdown and the Major's `НАЧАЛИ · GO` stamp (#214). */
  countdown: CountdownLabels;
  /** The overtake stamps (#232) and your finish stamp (#240): `ACCEPTED · 48 WPM`, `RETURNED · 2 ERRORS`. */
  stamps: StampRowLabels;
  /** The race announcer (#232 C4): `{desk}` is the other desk as paperwork (`07`). */
  announce: SeatAnnounceLabels;
  /** The connecting skeleton's name. */
  loading: string;
  /** The live notices, plus the phones-only notice (bible 7.4 notice row). */
  notice: RaceNoticeLabels & { phones: string };
  errors: SeatErrorLabels;
  abandon: AbandonLabels;
  /** The nixie counters (#225): the tube tags and the words their `aria-label` reads. */
  counters: NixieLabels;
  raceCard: RaceCardLabels;
  sabotageTray: SabotageTrayLabels;
  /** The finished view (#240): the docket after your finish and at RACE OVER, the Dawn report link. */
  finish: FinishLabels;
};

/** The polite status region's race lines (#232 C4; #242 adds the rest). */
export type SeatAnnounceLabels = { overtake: string; passed: string };

/** The lost line (bible 7.4 inline error line): the prefix, one sentence per reason, the way back. */
export type SeatErrorLabels = {
  prefix: string;
  closed: string;
  noRoom: string;
  inProgress: string;
  notFound: string;
  generic: string;
  /** The link back to `/lobby/[code]`. */
  back: string;
};

/** Phones watch from the back of the room (spectator mode is #292): the seat view shows only a notice. */
export const PHONE_MAX_WIDTH_PX = 480;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;

/** Tablets and small laptops get the compact race card (bible 7.4a): below 1280px. */
export const COMPACT_MAX_WIDTH_PX = 1279;
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH_PX}px)`;

/** Paperwork numbers: two digits at least (`DESK 05`, bible 2). */
export const paperwork = (n: number) => String(n).padStart(2, "0");
