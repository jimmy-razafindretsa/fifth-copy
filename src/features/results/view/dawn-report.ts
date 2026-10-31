/**
 * The Dawn report's view model (#300, bible 14.4, ARCHITECTURE 8.2): what `getDawnReport` reads from
 * `Race` and `RaceResult` (prisma/schema/race.prisma) and what the podium, the ranking (#301) and the
 * personal card (#302) render, without a second query. Plain data: no Prisma type, no hook, so the
 * components, `/design` and the tests share it. The WPM is the clean WPM (ADR 0016); the adjusted figure
 * never reaches this model. The `/design` and test fixtures live in `dawn-report-fixtures.ts` (they call
 * identity's `outfitForDesk`, and this module is also read by the client leaves through `embed-messages`).
 */

import type { Outfit } from "@/features/identity";

/** `RaceResult.status` (prisma/schema/race.prisma), as stored. */
export const REPORT_STATUSES = [
  "FINISHED",
  "TIMED_OUT",
  "REASSIGNED",
  "ASLEEP",
  "LINE_CUT",
  "EXPIRED",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type ReportEndReason = "ALL_FINISHED" | "TIMER" | "VOID";

export type ReportEntry = {
  desk: number;
  name: string;
  isBot: boolean;
  place: number;
  status: ReportStatus;
  /** Clean WPM (`RaceResult.cleanWpm`, ADR 0016). */
  wpm: number;
  /** 0..1 */
  accuracy: number;
  /** 0..1 */
  progress: number;
  finishedAtMs: number | null;
  /** Stored but under review (ADR 0008, ARCHITECTURE 7.7): shown with the `UNDER REVIEW` docket. */
  suspicious: boolean;
  /**
   * The clerk this desk wears on its plinth (#688, bible 10.1, 14.4): the player's saved outfit, else the
   * desk's fixed one (`outfitForDesk`, bots too), resolved by `getDawnReport`; never recomputed in the page.
   */
  outfit: Outfit;
};

export type ReportRace = {
  id: string;
  language: "en" | "fr";
  endedAt: Date | null;
  endReason: ReportEndReason | null;
  lobbyCode: string | null;
};

/**
 * `filing`: the race exists but the race server has not posted its results yet (it posts after `ended`,
 * ARCHITECTURE 9.3). `lobbyCode` lets the filing notice point back to the waiting room.
 */
export type DawnReport =
  | { kind: "filing"; raceId: string; lobbyCode: string | null }
  | { kind: "report"; race: ReportRace; entries: ReportEntry[]; viewerDesk: number | null };

export const MEDAL_VARIANTS = ["gold", "silver", "bronze"] as const;
export type MedalVariant = (typeof MEDAL_VARIANTS)[number];

/** Places on the podium and their medal (bible 13: the gold, silver and bronze variants of one model). */
export const PODIUM_PLACES = [1, 2, 3] as const;
export type PodiumPlace = (typeof PODIUM_PLACES)[number];
export const MEDAL_OF_PLACE: Record<PodiumPlace, MedalVariant> = {
  1: "gold",
  2: "silver",
  3: "bronze",
};

/** One plinth: its place and the entries filed at that place (none = `UNFILLED`, several = `TIED`). */
export type PlinthSlot = { place: PodiumPlace; entries: ReportEntry[] };

/**
 * The three plinths in place order: places 1, 2 and 3 read literally from `entries` (ties share a
 * plinth, a missing place stays empty), so places 1, 1, 3 give a tied first, an unfilled second and a
 * third. Entries keep their incoming order (place, then desk, from the query).
 */
export function placeSlots(entries: readonly ReportEntry[]): PlinthSlot[] {
  return PODIUM_PLACES.map((place) => ({
    place,
    entries: entries.filter((e) => e.place === place),
  }));
}

/** Accuracy as paperwork: `97 %` (a no-break space, French and English alike). */
export function formatAccuracy(accuracy: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, accuracy)) * 100);
  return `${pct} %`;
}

/** Clean WPM as shown on a plinth: a whole number. */
export function formatWpm(wpm: number): string {
  return String(Math.max(0, Math.round(wpm)));
}

/** Paperwork desk number: `07`. */
export const padDesk = (desk: number) => String(desk).padStart(2, "0");

/** The podium's copy (ADR 0010: the page reads it from the `results` catalog; `/design` the fixtures). */
export type PodiumLabels = {
  /** The podium list's accessible name. */
  title: string;
  /** The plinth tag: `№ {n}`. */
  place: string;
  /** `DESK {n}` (`n` zero-padded). */
  desk: string;
  bot: string;
  you: string;
  wpm: string;
  accuracy: string;
  unfilled: string;
  tied: string;
  underReview: string;
  /** The medal: `HERO OF PAPERWORK` (the fallback stamp, bible 13). */
  medal: string;
  /** The embed's title, per variant. */
  medalTitle: Record<MedalVariant, string>;
  status: Record<ReportStatus, string>;
};
