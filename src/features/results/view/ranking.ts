/**
 * The Dawn report's ranking docket (#301, bible 14.4 "Ranking docket"): every entry of one report as a
 * row, in place order. Pure (no Prisma, no hook): the page, `/design` and the tests share it. The WPM
 * column is the clean WPM (ADR 0016); suspicious rows stay in the docket, tagged (ADR 0008); the
 * viewer's row comes from `viewerDesk` (ADR 0009).
 */
import { padDesk, type ReportEntry, type ReportStatus } from "./dawn-report";

export type RankingRow = {
  /** Zero-padded place: `01`. */
  place: string;
  desk: number;
  name: string;
  /** The portrait cell's initials (`initialsOf`). */
  initials: string;
  /** The typist's portrait (#65); unset until the lobby-scoped avatar route exists. */
  avatarUrl?: string;
  isBot: boolean;
  suspicious: boolean;
  /** The viewer's own row. */
  you: boolean;
  /** Clean WPM, a whole number. */
  wpm: number;
  /** Accuracy as a whole percent: `0.974 -> 97`. */
  accuracy: number;
  statusKey: ReportStatus;
};

/** The docket's copy (ADR 0010: the page reads it from the `results` catalog). */
export type RankingLabels = {
  /** `FORM 5-R · RANKING`: the table's caption and the docket's header tag. */
  caption: string;
  columns: {
    place: string;
    typist: string;
    desk: string;
    wpm: string;
    accuracy: string;
    status: string;
  };
  /** The desk cell: `DESK {n}` (`n` zero-padded). */
  deskNumber: string;
  bot: string;
  you: string;
  underReview: string;
  status: Record<ReportStatus, string>;
};

/**
 * Up to two initials: the first code point of the first two whitespace-separated words, NFC, upper-cased
 * (`Typist Bot 2 -> TB`, `Lynx-785 -> L`).
 */
export function initialsOf(name: string): string {
  return name
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]!)
    .join("")
    .toUpperCase()
    .normalize("NFC");
}

const byPlace = (a: ReportEntry, b: ReportEntry) => a.place - b.place || a.desk - b.desk;

/** The report's entries as docket rows, in place order (then desk, as the query sorts ties). */
export function rankingRowsFrom(
  entries: readonly ReportEntry[],
  viewerDesk: number | null,
): RankingRow[] {
  return [...entries].sort(byPlace).map((e) => ({
    place: padDesk(e.place),
    desk: e.desk,
    name: e.name,
    initials: initialsOf(e.name),
    isBot: e.isBot,
    suspicious: e.suspicious,
    you: viewerDesk !== null && e.desk === viewerDesk,
    wpm: Math.max(0, Math.round(e.wpm)),
    accuracy: Math.round(Math.min(1, Math.max(0, e.accuracy)) * 100),
    statusKey: e.status,
  }));
}
