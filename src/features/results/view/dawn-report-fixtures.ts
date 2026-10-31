/**
 * The Dawn report fixtures (#300 C6, #688 C1): one report per podium state, for `/design#results` and the
 * tests. Server-side data (it reads identity's `outfitForDesk` through its barrel), kept apart from the
 * view model so the client leaves never pull the identity barrel in.
 */
import { OUTFIT_CATALOGUE, outfitForDesk, type Outfit } from "@/features/identity";
import type { DawnReport, ReportEntry, ReportRace } from "./dawn-report";

/** A saved outfit (the viewer's desk 12 in the six-desk race): ids from bible 10.1's catalogue. */
export const SAVED_OUTFIT: Outfit = {
  hair: "quiff",
  glasses: "monocle",
  hat: "beret",
  clothes: "jacket",
  face: "beard",
  // copper (bible 10.1); hair colours stay catalogue ids, never hex in TS (check-colours)
  hairCol: OUTFIT_CATALOGUE.hairCol[2]!,
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
  outfit: outfitForDesk(1),
};
/** An entry; unless given, the outfit is the desk's own (`outfitForDesk`, what an unsaved desk wears). */
const entry = (over: Partial<ReportEntry>): ReportEntry => ({
  ...ENTRY,
  outfit: outfitForDesk(over.desk ?? ENTRY.desk),
  ...over,
});

/**
 * A finished six-desk race: one bot on the podium (desk 3, `outfitForDesk(3)`), desk 12 in a saved outfit,
 * a cut line and a suspicious desk below it.
 */
const SIX: ReportEntry[] = [
  entry({ desk: 7, name: "Lynx-785", place: 1, wpm: 61.4, accuracy: 0.97 }),
  entry({ desk: 3, name: "Typist Bot 2", isBot: true, place: 2, wpm: 54.2, accuracy: 0.95 }),
  entry({
    desk: 12,
    name: "Heron-302",
    place: 3,
    wpm: 47.8,
    accuracy: 0.92,
    outfit: SAVED_OUTFIT,
  }),
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
): Extract<DawnReport, { kind: "report" }> => ({
  kind: "report",
  race: race(id),
  entries,
  viewerDesk,
});

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
