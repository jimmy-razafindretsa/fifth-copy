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
