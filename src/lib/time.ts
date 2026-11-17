/**
 * The stats day (ADR 0008, #931): every stats figure that groups by day (streak, 7-day averages, the
 * races of the last 7 days, later the daily per-character rollup of #314) uses the calendar day in
 * this zone, whatever the server's own zone. Pure, `Intl` only.
 */
export const STATS_TIME_ZONE = "America/Toronto";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A day key: `YYYY-MM-DD`, the calendar day in `STATS_TIME_ZONE`. */
export type DayKey = string;

/** The `STATS_TIME_ZONE` calendar day of an instant, as `YYYY-MM-DD`. */
export function dayKey(at: Date): DayKey {
  const parts = dayFormat.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The day key `days` calendar days after `key` (negative: before). Calendar arithmetic, no zone. */
export function addDays(key: DayKey, days: number): DayKey {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/**
 * An instant at noon Toronto on the stats day `daysAgo` days before `now`'s stats day (#975): 17:00Z of
 * that day key, which is 12:00 EST or 13:00 EDT, so always inside that Toronto day. Based on the Toronto
 * day, not the UTC one: between 00:00Z and 05:00Z the UTC date is already a day ahead.
 */
export function statsDayNoon(daysAgo: number, now: Date = new Date()): Date {
  return new Date(`${addDays(dayKey(now), -daysAgo)}T17:00:00Z`);
}
