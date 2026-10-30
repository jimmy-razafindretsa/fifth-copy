export { connectToRoom } from "./client/socket";
export type {
  ConnectErrorReason,
  HostSettingsResult,
  HostStartResult,
  Off,
  ProtocolError,
  RoomEvents,
  RoomSocket,
} from "./client/socket";
/** The seat view (#561, ARCHITECTURE 8.2, ADR 0013): the route's server lookup, the shell, and the one race
 * store the HUD reads (and the scene, #563). `getRaceSeat` is a server function, so this index stays
 * importable from client modules (the lobby loads it lazily). */
export { getRaceSeat, type RaceSeatInfo } from "./queries/get-race-seat";
export { RaceSeat, type RaceSeatProps } from "./seat/race-seat";
/** The machine's keys for a viewer (#224): a server function, so identity never reaches a client graph. */
export { machineRows } from "./view/machine-rows";
export type { RaceSeatLabels, SeatErrorLabels } from "./seat/seat-view";
export type { MintRaceToken } from "./client/connect-seat";
export { bindRaceSocket, createRaceStore, initialRaceState, reduceRace } from "./client/store";
export type {
  RaceEvent,
  RaceLostReason,
  RacePhase,
  RaceState,
  RaceStore,
  RaceTokenError,
} from "./client/store";
export { RaceStoreProvider, useRaceStore } from "./client/use-race-store";
export { readResumeKey, storeResumeKey, clearResumeKey } from "./client/resume-key";
/** The waiting room -> seat view handover (#214): the lobby parks its socket; `connectSeat` closes it. */
export { parkSocket } from "./client/handoff";
/** The typing surface (#558, ADR 0013): pure components that render a TypedView (derived in #559) and the
 * typing machine behind its skin seam (bible 7.7a). */
export { TelexStrip, type TelexLabels } from "./components/telex-strip";
/** The race's key capture (#559 C4): a visually hidden input the seat view locks and feeds. */
export { RaceInput, type RaceInputProps } from "./components/race-input";
export { TypedSheet } from "./components/typed-sheet";
export { TypingMachine, type TypingMachineProps } from "./components/machine/typing-machine";
export { machineSkinIds, type MachineSkinId } from "./components/machine/skin";
export { typedViewFixtures } from "./view/typed-view";
export type { CharState, TypedChar, TypedView, TypedViewFixture } from "./view/typed-view";
/** The seat view HUD dockets (#560, ADR 0013): pure components rendering what the race store hands them
 * (ranks, progress and WPM arrive as props, ADR 0007), with their view model and copy (bible 7.4a, 7.11). */
export { NixieCounters, NIXIE_WPM_MAX, type NixieCountersProps } from "./components/nixie-counters";
export { RaceCard, type RaceCardProps } from "./components/race-card";
export { SabotageTray, type SabotageTrayProps } from "./components/sabotage-tray";
export {
  ABANDON_CONFIRM_MS,
  AbandonControl,
  type AbandonControlProps,
  type AbandonState,
} from "./components/abandon-control";
export { RaceNotice, type RaceNoticeProps } from "./components/race-notice";
export { raceCardViewFixtures, MARKER_SHAPES, LANE_STATUSES } from "./view/race-card-view";
export type {
  FieldTick,
  Lane,
  LaneStatus,
  MarkerInk,
  MarkerShape,
  RaceCardView,
  RaceCardViewFixture,
} from "./view/race-card-view";
export { hudLabelFixtures, RACE_NOTICES, SABOTAGE_CARDS } from "./view/hud-labels";
export type {
  AbandonLabels,
  HudLabels,
  NixieLabels,
  RaceCardLabels,
  RaceNoticeKind,
  RaceNoticeLabels,
  SabotageCard,
  SabotageTrayLabels,
} from "./view/hud-labels";
/** The 3D seat scene's one input (#563, ADR 0017): a memoised view of the store; race-3d reads nothing else. */
export { selectSceneView } from "./view/scene-view";
export type { SceneDesk, ScenePhase, SceneView } from "./view/scene-view";
/** The scene's loading card (#563 C2) and the phone query the scene leaf skips (phones watch, #292). */
export { LoadingCard, type LoadingCardProps, type SceneLabels } from "./components/loading-card";
export { PHONE_QUERY } from "./seat/seat-view";
