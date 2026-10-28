/**
 * The Dawn report's view model (#300, bible 14.4, ARCHITECTURE 8.2): what `getDawnReport` reads from
 * `Race` and `RaceResult` (prisma/schema/race.prisma) and what the podium, the ranking (#301) and the
 * personal card (#302) render, without a second query. Plain data: no Prisma type, no hook, so the
 * components, `/design` and the tests share it. The WPM is the clean WPM (ADR 0016); the adjusted figure
 * never reaches this model.
 */

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

const ENTRY: ReportEntry = {
  desk: 1,
  name: "Lynx-785",
  isBot: false,
  place: 1,
  status: "FINISHED",
  wpm: 61.4,
  accuracy: 0.97,
  progress: 1,
  finishedAtMs: 48_200,
  suspicious: false,
};
const entry = (over: Partial<ReportEntry>): ReportEntry => ({ ...ENTRY, ...over });

/** A finished six-desk race: one bot on the podium, a cut line and a suspicious desk below it. */
const SIX: ReportEntry[] = [
  entry({ desk: 7, name: "Lynx-785", place: 1, wpm: 61.4, accuracy: 0.97 }),
  entry({ desk: 3, name: "Typist Bot 2", isBot: true, place: 2, wpm: 54.2, accuracy: 0.95 }),
  entry({ desk: 12, name: "Heron-302", place: 3, wpm: 47.8, accuracy: 0.92 }),
  entry({ desk: 5, name: "Otter-417", place: 4, status: "LINE_CUT", wpm: 38.1, progress: 0.71 }),
  entry({ desk: 9, name: "Badger-126", place: 5, status: "TIMED_OUT", wpm: 31, progress: 0.66 }),
  entry({ desk: 2, name: "Crow-559", place: 6, wpm: 29.5, suspicious: true }),
];

const race = (id: string): ReportRace => ({
  id,
  language: "en",
  endedAt: new Date("2026-10-08T08:14:00Z"),
  endReason: "ALL_FINISHED",
  lobbyCode: "KGB-4821",
});

const report = (
  id: string,
  entries: ReportEntry[],
  viewerDesk: number | null = null,
): Extract<DawnReport, { kind: "report" }> => ({ kind: "report", race: race(id), entries, viewerDesk });

/** `/design#results` and the tests: one fixture per podium state (C6). */
export const dawnReportFixtures = {
  full: report("3b241101-e2bb-4255-8caf-4136c566a962", SIX),
  "two-finishers": report("9c5b94b1-35ad-49bb-b118-8e8fc24abf80", [
    entry({ desk: 4, name: "Marmot-233", place: 1, wpm: 44.6, accuracy: 0.96 }),
    entry({ desk: 8, name: "Sparrow-482", place: 2, wpm: 39.9, accuracy: 0.9 }),
  ]),
  tie: report("16fd2706-8baf-433b-82eb-8c7fada847da", [
    entry({ desk: 6, name: "Hedgehog-871", place: 1, wpm: 52, accuracy: 0.98 }),
    entry({ desk: 11, name: "Lynx-104", place: 1, wpm: 52, accuracy: 0.94 }),
    entry({ desk: 1, name: "Typist Bot 1", isBot: true, place: 3, wpm: 45.3, accuracy: 0.93 }),
  ]),
  "under-review": report("6a2f41a3-c54c-4b5c-8f0f-6a3e1d2b7c90", [
    entry({ desk: 7, name: "Lynx-785", place: 1, wpm: 118.2, accuracy: 0.99, suspicious: true }),
    entry({ desk: 3, name: "Typist Bot 2", isBot: true, place: 2, wpm: 54.2, accuracy: 0.95 }),
    entry({ desk: 12, name: "Heron-302", place: 3, wpm: 47.8, accuracy: 0.92 }),
  ]),
  viewer: report("0b1e8a52-77a4-4f0e-9d3b-2c8f5e6a1d44", SIX, 12),
} satisfies Record<string, Extract<DawnReport, { kind: "report" }>>;

export type DawnReportFixture = keyof typeof dawnReportFixtures;
