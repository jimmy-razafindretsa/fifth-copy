import type { Locale } from "@/i18n/locale";
import { STATS_TIME_ZONE } from "@/lib/time";
import type { Profile, ProfileService } from "./profile";

/**
 * Display formatting for the Personnel file page (#932): numbers in the page's locale, never arithmetic
 * on the figures beyond rounding them for show (ADR 0016: clean WPM only, as `Profile.service` holds it).
 */

/** No-break space: between a figure and its unit (`96,1 %`). */
export const NBSP = " ";
/** A figure with no race behind it (C7). */
export const BLANK_FIGURE = "—";
/** A tube with no race behind it (C5). */
export const BLANK_TUBE = "--";
/** Below this many counted races the file shows the blank block (C8). */
export const BLANK_BELOW = 3;

const tag = (locale: Locale) => `${locale}-CA`;

/** One decimal in the page's locale (`44,8` / `44.8`). */
export function oneDecimal(n: number, locale: Locale): string {
  return new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

/** A share (0..1) as a percentage with one decimal (`0.961` -> `96,1`). */
export function percent(share: number, locale: Locale): string {
  return oneDecimal(share * 100, locale);
}

/** Milliseconds as `hh:mm:ss`, hours at least two digits (`14:32:08`). */
export function totalTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** The digits that end the typist name (`DOCKET-829` -> `829`), or null when it ends otherwise. */
export function fileNumber(name: string | null | undefined): string | null {
  return name?.match(/(\d+)$/)?.[1] ?? null;
}

/** The day the file was opened, long form in the stats time zone (`24 mai 2023` / `May 24, 2023`). */
export function serviceDate(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), {
    dateStyle: "long",
    timeZone: STATS_TIME_ZONE,
  }).format(at);
}

/** Which languages the file has raced in: both, one, or none (the service line's second sentence). */
export function racedLanguages(profile: Profile): "both" | "FR" | "EN" | null {
  const fr = profile.languages.FR.races > 0;
  const en = profile.languages.EN.races > 0;
  if (fr && en) return "both";
  if (fr) return "FR";
  if (en) return "EN";
  return null;
}

export type TubeKey = "avgWpm" | "best" | "accuracy" | "medals";
export type Tube = { key: TubeKey; value: string; blank: boolean };

/** The four hero tubes (C5): mean and best clean WPM rounded, mean accuracy one decimal, wins. */
export function tubes(service: ProfileService, locale: Locale): Tube[] {
  const whole = (n: number | null): Tube["value"] =>
    n === null ? BLANK_TUBE : String(Math.round(n)).padStart(2, "0");
  return [
    { key: "avgWpm", value: whole(service.meanWpm), blank: service.meanWpm === null },
    { key: "best", value: whole(service.bestWpm), blank: service.bestWpm === null },
    {
      key: "accuracy",
      value: service.meanAccuracy === null ? BLANK_TUBE : percent(service.meanAccuracy, locale),
      blank: service.meanAccuracy === null,
    },
    {
      key: "medals",
      value: String(service.wins ?? 0).padStart(2, "0"),
      blank: false,
    },
  ];
}

export type FigureKey =
  | "totalTime"
  | "races"
  | "bestSpeed"
  | "averageSpeed"
  | "bestAccuracy"
  | "averageAccuracy"
  | "wins"
  | "podiums";
export type FigureUnit = "wpm" | "percent" | "firstPlace" | "top3" | null;
export type Figure = { key: FigureKey; value: string; unit: FigureUnit; red?: boolean };

/** The eight service-record cells (C7), in the reference's order; `—` and no unit with no race. */
export function figures(service: ProfileService, locale: Locale): Figure[] {
  const blank = service.races === 0;
  const cell = (
    key: FigureKey,
    value: number | null,
    show: (n: number) => string,
    unit: FigureUnit,
    red = false,
  ): Figure =>
    blank || value === null
      ? { key, value: BLANK_FIGURE, unit: null, red }
      : { key, value: show(value), unit, red };
  const count = (n: number) => String(n);
  const wpm = (n: number) => oneDecimal(n, locale);
  const pct = (n: number) => percent(n, locale);
  return [
    cell("totalTime", service.totalMs, totalTime, null),
    cell("races", service.races, count, null),
    cell("bestSpeed", service.bestWpm, wpm, "wpm", true),
    cell("averageSpeed", service.meanWpm, wpm, "wpm"),
    cell("bestAccuracy", service.bestAccuracy, pct, "percent"),
    cell("averageAccuracy", service.meanAccuracy, pct, "percent"),
    cell("wins", service.wins, count, "firstPlace"),
    cell("podiums", service.podiums, count, "top3"),
  ];
}
