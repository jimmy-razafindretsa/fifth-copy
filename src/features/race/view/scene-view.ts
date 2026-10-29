import { charsOf, normalizeTypeable } from "@fifth-copy/engine";
import { PLAYER_STATUSES, type Member, type Snapshot } from "@fifth-copy/protocol";
import { selectField } from "./race-card-view";

type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/**
 * The one value the 3D seat scene reads (ADR 0017 "the shared core", #563): the store's roster joined
 * with the last snapshot, as plain data the race-3d feature posts to `/3d/seat.html`. Pure and memoised:
 * the store notifies on every predicted key, so an unchanged view keeps its reference and the scene is
 * never told twice. Later cards add fields, never channels (#254 ring, #267 typists and lamp, #272 bulb,
 * #287 projector camera). No race rule here: ranks, cursors and statuses are the server's (ADR 0006),
 * progress is the engine's own `progress` (ADR 0007, through `selectField`).
 */

/** One occupied desk. `tint`: the desk's colour slot (`desk-color-<0..11>`, protocol `DESK_COLORS`). */
export type SceneDesk = {
  desk: number;
  tint: string;
  status: PlayerStatus;
  /** 1 = leading; `null` before the first ranked snapshot. */
  rank: number | null;
  /** 0..1. */
  progress: number;
};

export type ScenePhase = "waiting" | "countdown" | "running" | "ended";

export type SceneView = {
  /** Your desk: its clerk and paper are hidden (bible 11.3); `null` for a spectator. */
  self: number | null;
  /** Sorted by desk. */
  desks: SceneDesk[];
  /** The Major's lamp target desk (#267); `null` until then. */
  lamp: number | null;
  phase: ScenePhase;
};

/** The store fields the scene reads, declared structurally so this module stays free of the client. */
export type SceneSource = {
  readonly phase: string;
  readonly you: number | null;
  readonly members: readonly Member[];
  readonly desks: Snapshot["desks"];
  readonly ranks: Snapshot["ranks"];
  readonly race: { readonly text: string } | null;
};

const ROOM_PHASES: readonly string[] = ["waiting", "countdown", "running", "ended"];

/** The room's phase; connecting, a cut line and a lost seat keep the room as it was (running with a race). */
const scenePhase = (phase: string, racing: boolean): ScenePhase =>
  ROOM_PHASES.includes(phase) ? (phase as ScenePhase) : racing ? "running" : "waiting";

function viewFrom({ phase, you, members, desks, ranks, race }: SceneSource): SceneView {
  const textLength = race ? charsOf(normalizeTypeable(race.text)).length : 0;
  const ticks = new Map(selectField(desks, textLength).map((t) => [t.desk, t.progress]));
  const codes = new Map(desks.map((d) => [d[0], d[4]]));
  const rankOf = new Map(ranks.map((desk, i) => [desk, i + 1]));
  return {
    self: you,
    desks: [...members]
      .sort((a, b) => a.desk - b.desk)
      .map((m) => ({
        desk: m.desk,
        tint: `desk-color-${m.color}`,
        status: PLAYER_STATUSES[codes.get(m.desk) ?? 0] ?? "typing",
        rank: rankOf.get(m.desk) ?? null,
        progress: race ? (ticks.get(m.desk) ?? 0) : 0,
      })),
    lamp: null,
    phase: scenePhase(phase, race !== null),
  };
}

let last: { source: SceneSource; view: SceneView } | null = null;

const sameSource = (a: SceneSource, b: SceneSource) =>
  a.members === b.members &&
  a.you === b.you &&
  a.desks === b.desks &&
  a.ranks === b.ranks &&
  a.race === b.race &&
  scenePhase(a.phase, a.race !== null) === scenePhase(b.phase, b.race !== null);

/**
 * The scene's view of the store (ADR 0017): the same object while roster, you, snapshot, race and room
 * phase are unchanged (a keystroke or a `sent` returns the previous view).
 */
export function selectSceneView(source: SceneSource): SceneView {
  if (last && sameSource(last.source, source)) return last.view;
  const view = viewFrom(source);
  last = { source, view };
  return view;
}
