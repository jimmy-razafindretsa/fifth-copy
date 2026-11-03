import { fill } from "@/i18n/format";
import type { RacePhase, RaceState } from "../client/store";
import type { RaceStamp } from "../client/stamps";
import type { CountdownLabels, CountdownStep } from "../components/countdown";
import { stampText, type StampRowLabels } from "../components/stamp-row";
import { paperwork, type SeatAnnounceLabels } from "../seat/seat-view";
import { selectFinishWpm, selectPlace } from "./counters";

/**
 * The race announcer's sentences (#242, ARCHITECTURE 10, WCAG 4.1.3): a pure function of two views of
 * the race store and the countdown step, no React, no timers. Announcements carry numbers and desk ids
 * only (no string of the race), so no character of the race text can reach the live region; their
 * words come from the catalogs (`announcementText`). The region paces them (`createAnnounceQueue`).
 */

/** What the announcer reads of the seat: primitives and the visible stamp, one view per change. */
export type AnnounceView = {
  /** This device's clock when the view was taken. */
  at: number;
  phase: RacePhase;
  /** The countdown's step (#214): `3`, `2`, `1`, `go`, or `null` once the GO stamp left. */
  step: CountdownStep | null;
  /** The visible stamp (#232, #240), or `null`. */
  stamp: Pick<RaceStamp, "id" | "kind" | "other" | "errors"> | null;
  /** Your finish figure (`selectFinishWpm`): the finish stamp's line reads it. */
  wpm: number;
  /** Your live place and the desks in the race (`selectPlace`); `0` without a desk. */
  place: number;
  total: number;
  /** Your desk is still typing in a running race (no finish, no exit). */
  typing: boolean;
  /** The server ended the race (not `void`): your final place (`0` when unranked) of the ranking. */
  over: { place: number; total: number } | null;
};

export type Announcement =
  | { kind: "count"; n: 3 | 2 | 1 }
  | { kind: "go" }
  | { kind: "place"; place: number; total: number }
  | { kind: "overtake"; desk: number }
  | { kind: "passed"; desk: number }
  | { kind: "finished"; place: number; total: number }
  | { kind: "filed"; stamp: "accepted" | "returned"; errors: number; wpm: number }
  | { kind: "over"; place: number; total: number };

/** The last place the region said, and when: a place line comes at most once per `PLACE_EVERY_MS`. */
export type PlaceMemo = { place: number; at: number } | null;

export const PLACE_EVERY_MS = 5_000;

/**
 * The sentences from `prev` to `next` (`prev` null: the first view) and the new place memo. In order:
 * the countdown step when it changes (`3`, `2`, `1`, `GO`); a new visible stamp: `overtake` / `passed`
 * (each one stands for the place change it made), or your finish with your place and then the finish
 * stamp's line; the race over once; else your place, once the GO stamp left, while you type, when it
 * differs from the last place said and `PLACE_EVERY_MS` passed since (the first one at once). A new
 * countdown forgets the last race's place.
 */
export function announcementsFor(
  prev: AnnounceView | null,
  next: AnnounceView,
  memo: PlaceMemo = null,
): { said: Announcement[]; memo: PlaceMemo } {
  const said: Announcement[] = [];
  if (next.phase === "countdown" && prev?.phase !== "countdown") memo = null;
  if (next.step !== null && next.step !== prev?.step) {
    said.push(next.step === "go" ? { kind: "go" } : { kind: "count", n: next.step });
  }
  const stamp = next.stamp;
  if (stamp && stamp.id !== prev?.stamp?.id) {
    if (stamp.kind === "overtake" || stamp.kind === "passed") {
      said.push({ kind: stamp.kind, desk: stamp.other });
      if (next.place > 0) memo = { place: next.place, at: next.at };
    } else {
      said.push({ kind: "finished", place: next.place, total: next.total });
      said.push({ kind: "filed", stamp: stamp.kind, errors: stamp.errors, wpm: next.wpm });
    }
  }
  if (next.over && !prev?.over) said.push({ kind: "over", ...next.over });
  const placeDue =
    said.length === 0 &&
    next.typing &&
    next.phase === "running" &&
    next.step === null &&
    next.place > 0 &&
    (memo === null || (memo.place !== next.place && next.at - memo.at >= PLACE_EVERY_MS));
  if (placeDue) {
    said.push({ kind: "place", place: next.place, total: next.total });
    memo = { place: next.place, at: next.at };
  }
  return { said, memo };
}

/**
 * Milliseconds until a withheld place change is due (`announcementsFor` says it then, if it still
 * holds), or `null` when none waits: the region re-reads the store then, as no snapshot may change the
 * view meanwhile.
 */
export function placeDueIn(next: AnnounceView, memo: PlaceMemo): number | null {
  if (memo === null || !next.typing || next.phase !== "running" || next.step !== null) return null;
  if (next.place === 0 || next.place === memo.place) return null;
  return Math.max(0, memo.at + PLACE_EVERY_MS - next.at);
}

export type AnnouncerLabels = {
  announce: SeatAnnounceLabels;
  countdown: CountdownLabels;
  stamps: StampRowLabels;
};

/** One announcement in the page's language (bible 2, 14.3): desks as paperwork (`07`). */
export function announcementText(a: Announcement, labels: AnnouncerLabels): string {
  const { announce } = labels;
  switch (a.kind) {
    case "count":
      return String(a.n);
    case "go":
      return labels.countdown.go;
    case "place":
      return fill(announce.place, { place: a.place, total: a.total });
    case "overtake":
    case "passed":
      return fill(announce[a.kind], { desk: paperwork(a.desk) });
    case "finished":
      return fill(announce.finished, { place: a.place, total: a.total });
    case "filed":
      return stampText({ kind: a.stamp, errors: a.errors }, a.wpm, labels.stamps);
    case "over":
      return a.place > 0
        ? fill(announce.over, { place: a.place, total: a.total })
        : announce.overUnranked;
  }
}

/** How long a line stays in the region before the next one replaces it (the bounded rate). */
export const ANNOUNCE_DWELL_MS = 750;
/** Lines waiting behind the one shown; a burst past it keeps the newest. */
export const ANNOUNCE_MAX_PENDING = 3;

export type AnnounceLine = { id: number; text: string };

/**
 * The region's pace: each line shows for at least `ANNOUNCE_DWELL_MS`, in order, with at most
 * `ANNOUNCE_MAX_PENDING` waiting; an idle queue shows a new line at once. Every line gets a new id, so
 * the region remounts its text and the same sentence twice is read twice.
 */
export function createAnnounceQueue(show: (line: AnnounceLine) => void) {
  let seq = 0;
  let pending: string[] = [];
  let handle: ReturnType<typeof setTimeout> | null = null;
  const next = () => {
    handle = null;
    const text = pending.shift();
    if (text === undefined) return;
    show({ id: ++seq, text });
    handle = setTimeout(next, ANNOUNCE_DWELL_MS);
  };
  return {
    push(lines: readonly string[]) {
      pending = [...pending, ...lines];
      if (handle === null) next();
      if (pending.length > ANNOUNCE_MAX_PENDING) pending = pending.slice(-ANNOUNCE_MAX_PENDING);
    },
    dispose() {
      if (handle !== null) clearTimeout(handle);
      handle = null;
      pending = [];
    },
  };
}

/*
 * The announcer's reads of the race store: each a primitive (or the store's own stamp object), so the
 * region re-renders only when what it may say changes, never on a plain key.
 */
export const selectAnnounceStamp = (s: RaceState) => s.stamps[0] ?? null;
/** Your finish figure, read only while a finish stamp shows. */
export const selectAnnounceWpm = (s: RaceState) => {
  const kind = s.stamps[0]?.kind;
  return kind === "accepted" || kind === "returned" ? selectFinishWpm(s) : 0;
};
export const selectAnnouncePlace = (s: RaceState) => selectPlace(s).place;
export const selectAnnounceTotal = (s: RaceState) => selectPlace(s).total;
export const selectAnnounceTyping = (s: RaceState) =>
  s.phase === "running" && s.prediction?.state.status === "typing" && s.exit === null;
const ending = (s: RaceState) =>
  s.phase === "ended" && s.ending !== null && s.ending.reason !== "void" ? s.ending : null;
export const selectAnnounceOver = (s: RaceState) => ending(s) !== null;
/** Your place in the server's final ranking, `0` when it does not rank you. */
export const selectAnnounceFinalPlace = (s: RaceState) =>
  ending(s)?.ranking.find((r) => r.desk === s.you)?.place ?? 0;
export const selectAnnounceFinalTotal = (s: RaceState) => ending(s)?.ranking.length ?? 0;
