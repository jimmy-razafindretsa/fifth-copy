import type { Locale } from "@/i18n/locale";
import { STATS_TIME_ZONE } from "@/lib/time";

/**
 * Race archives (#936, bible 14.3 "Archives des courses", spec 13.2, ADR 0008, 0016): the viewer's
 * `ARCHIVE_LIMIT` latest counted results, newest first. Pure; the query reads the room through the
 * race's lobby and counts (never reads) the other humans of the race. Extension point: a full history
 * page reuses `ArchiveEntry` and the query with a cursor.
 */

/** The docket lists this many latest results. */
export const ARCHIVE_LIMIT = 8;

/** `BOTS`: no other human in the race; `PRIVATE`: a private lobby; `RACE`: anything else. */
export type ArchiveMode = "BOTS" | "PRIVATE" | "RACE";

export type ArchiveEntry = {
  /** ISO instant of the result. */
  at: string;
  /** The lobby's room code, `null` when the race has no lobby. */
  room: string | null;
  mode: ArchiveMode;
  /** 1 = won; `null` when the result has no place. */
  place: number | null;
  /** Desks in the race (`Race.lobbySize`), `null` when unknown. */
  lobbySize: number | null;
  cleanWpm: number;
  /** 0..1. */
  accuracy: number;
};

/** The mode of a race from the other humans' count and its lobby's type. */
export function modeOf(otherHumans: number, lobbyType: "PRIVATE" | "PUBLIC" | null): ArchiveMode {
  if (otherHumans === 0) return "BOTS";
  return lobbyType === "PRIVATE" ? "PRIVATE" : "RACE";
}

/** What an archive row needs of a counted result. */
export type ArchiveRow = {
  createdAt: Date;
  cleanWpm: number;
  accuracy: number;
  place: number;
  room?: string | null;
  mode?: ArchiveMode;
  lobbySize?: number | null;
};

/** The `ARCHIVE_LIMIT` latest of `rows` (any order), newest first. */
export function archiveOf(rows: ArchiveRow[]): ArchiveEntry[] {
  return [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, ARCHIVE_LIMIT)
    .map((r) => ({
      at: r.createdAt.toISOString(),
      room: r.room ?? null,
      mode: r.mode ?? "BOTS",
      place: r.place >= 1 ? r.place : null,
      lobbySize: r.lobbySize ?? null,
      cleanWpm: r.cleanWpm,
      accuracy: r.accuracy,
    }));
}

/** A row's tag: `medal` for a first place, `podium` for second and third, else none. */
export function awardOf(place: number | null): "medal" | "podium" | null {
  if (place === 1) return "medal";
  if (place === 2 || place === 3) return "podium";
  return null;
}

/** The row's date in the stats time zone, `12 NOV · 10:42` (locale month, upper case, no dot). */
export function archiveDate(at: string, locale: Locale): string {
  const parts = new Intl.DateTimeFormat(`${locale}-CA`, {
    timeZone: STATS_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const month = part("month").replace(/\.$/, "").toLocaleUpperCase(`${locale}-CA`);
  return `${part("day")} ${month} · ${part("hour")}:${part("minute")}`;
}
