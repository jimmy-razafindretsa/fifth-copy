import type { Member } from "@fifth-copy/protocol";
import type { TelexLabels } from "../components/telex-strip";
import type {
  AbandonLabels,
  NixieLabels,
  RaceCardLabels,
  RaceNoticeLabels,
  SabotageTrayLabels,
} from "../view/hud-labels";
import type { RaceCardView } from "../view/race-card-view";
import type { TypedView } from "../view/typed-view";

/**
 * The seat view's copy (#561 C6): the `race` namespace of both catalogs, one language per page (ADR
 * 0010). The HUD parts take the label types of their components, so a catalog that drifts from them
 * fails the type-check.
 */
export type RaceSeatLabels = {
  /** The page's heading, a kicker: `SEAT VIEW` until the welcome, then `SEAT VIEW · DESK {n}`. */
  kicker: { seat: string; desk: string };
  telex: TelexLabels;
  /** The connecting skeleton's name. */
  loading: string;
  /** The live notices, plus the phones-only notice (bible 7.4 notice row). */
  notice: RaceNoticeLabels & { phones: string };
  errors: SeatErrorLabels;
  abandon: AbandonLabels;
  nixie: NixieLabels;
  raceCard: RaceCardLabels;
  sabotageTray: SabotageTrayLabels;
};

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

/** The typing surface before the start: no text yet (it arrives with the countdown, #214). */
export const BEFORE_START_VIEW: TypedView = {
  chars: [],
  cursor: 0,
  jammed: false,
  lastTypedAt: null,
};

/**
 * The machine's keys until the player's layout arrives as data (#224): the QWERTY rows of the
 * `/design` specimens, number row first.
 */
export const SEAT_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
];

/** Paperwork numbers: two digits at least (`DESK 05`, bible 2). */
export const paperwork = (n: number) => String(n).padStart(2, "0");

/**
 * The race card before the start: one tick per seated typist on the full-field line, all at the start
 * (yours marked), and no lanes yet: ranks only exist once the race runs (#564 selects the lanes from the
 * snapshots). A projection of the roster, no race rule (ADR 0007).
 */
export function beforeStartRaceCard(members: readonly Member[], you: number | null): RaceCardView {
  return {
    field: members.map((m) => ({ desk: m.desk, progress: 0, you: m.desk === you })),
    lanes: [],
  };
}
