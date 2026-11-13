import type { Member, RaceSettings } from "@fifth-copy/protocol";

/**
 * The waiting room's view model (#937, bible 7.4 "Waiting room"): pure, from the #926 store slices
 * (no wire change). The docket rows, this device's five load steps, the percent and the arrivals.
 */

/** The five steps of the progress line, in order (bible 7.4 "Waiting room"). */
export const WAITING_STEPS = ["papers", "desk", "machines", "copy", "major"] as const;
export type WaitingStep = (typeof WAITING_STEPS)[number];
export type WaitingStepState = "done" | "current" | "todo";

export type WaitingRoomInput = {
  /** The room code (`welcome.room.code`); `null` before the welcome. */
  code: string | null;
  settings: Pick<RaceSettings, "language" | "textType"> | null;
  /** Your desk; `null` for a page without one (the watching host). */
  you: number | null;
  /** Sorted by desk. */
  members: readonly Member[];
  /** The desks the room still awaits (#926); `null` outside `loading`. */
  pending: readonly number[] | null;
  /** The race text is in (the `loading` event carries it). */
  raceIn: boolean;
  /** This page's scene is settled: first frame, or paper (#926). */
  sceneSettled: boolean;
};

export type WaitingRoomView = {
  code: string | null;
  textType: RaceSettings["textType"] | null;
  language: RaceSettings["language"] | null;
  /** Your desk, two digits; `null` without one (no DESK row). */
  desk: string | null;
  /** Desks ready over desks in the race, bots included: `01 / 03`. */
  ready: string;
  steps: { id: WaitingStep; state: WaitingStepState }[];
  /** The first step not done; `null` when all are. */
  current: WaitingStep | null;
  /** `round(100 × (own steps done + desks-ready share) / 5)`. */
  percent: number;
  /** Arrived members, newest first. */
  arrivals: { desk: string; name: string }[];
};

const two = (n: number) => String(n).padStart(2, "0");

/** The members whose desk the room no longer awaits, by desk. */
export function arrivedDesks(members: readonly Member[], pending: readonly number[] | null): number[] {
  if (pending === null) return [];
  return members.filter((m) => !pending.includes(m.desk)).map((m) => m.desk);
}

/**
 * The arrival order, newest first (#937 C4): desks that arrived since `prev` go first (a batch by desk
 * number), earlier arrivals keep their order after them, desks no longer arrived drop out. Returns
 * `prev` itself when nothing changed, so a leaf's state stays put.
 */
export function arrivalOrder(prev: readonly number[], arrived: readonly number[]): readonly number[] {
  const now = new Set(arrived);
  const kept = prev.filter((d) => now.has(d));
  const fresh = arrived.filter((d) => !prev.includes(d)).sort((a, b) => a - b);
  if (fresh.length === 0 && kept.length === prev.length) return prev;
  return [...fresh, ...kept];
}

export function waitingRoomView(input: WaitingRoomInput, order: readonly number[]): WaitingRoomView {
  const pending = input.pending ?? [];
  const total = input.members.length;
  const readyCount = Math.max(0, total - pending.length);
  const share = total === 0 ? 0 : readyCount / total;
  const own: Record<Exclude<WaitingStep, "major">, boolean> = {
    papers: input.raceIn,
    desk: input.raceIn,
    machines: input.raceIn && input.sceneSettled,
    copy: input.raceIn && input.sceneSettled && (input.you === null || !pending.includes(input.you)),
  };
  const done = (id: WaitingStep) => (id === "major" ? pending.length === 0 && own.copy : own[id]);
  const current = WAITING_STEPS.find((id) => !done(id)) ?? null;
  const ownDone = Object.values(own).filter(Boolean).length;
  const byDesk = new Map(input.members.map((m) => [m.desk, m.name]));
  return {
    code: input.code,
    textType: input.settings?.textType ?? null,
    language: input.settings?.language ?? null,
    desk: input.you === null ? null : two(input.you),
    ready: `${two(readyCount)} / ${two(total)}`,
    steps: WAITING_STEPS.map((id) => ({
      id,
      state: done(id) ? "done" : id === current ? "current" : "todo",
    })),
    current,
    percent: Math.round((100 * (ownDone + share)) / 5),
    arrivals: order.flatMap((d) => {
      const name = byDesk.get(d);
      return name === undefined ? [] : [{ desk: two(d), name }];
    }),
  };
}
