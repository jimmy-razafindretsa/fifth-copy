export { connectToRoom } from "./client/socket";
export type {
  ConnectErrorReason,
  HostSettingsResult,
  ProtocolError,
  RoomEvents,
  RoomSocket,
} from "./client/socket";
/** The typing surface (#558, ADR 0013): pure components that render a TypedView (derived in #559) and the
 * typing machine behind its skin seam (bible 7.7a). */
export { TelexStrip, type TelexLabels } from "./components/telex-strip";
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
