export { connectToRoom } from "./client/socket";
export type {
  ConnectErrorReason,
  HostSettingsResult,
  ProtocolError,
  RoomEvents,
  RoomSocket,
} from "./client/socket";
/** The typing surface (#558, ADR 0013): pure components that render a TypedView (derived in #559). */
export { TelexStrip, type TelexLabels } from "./components/telex-strip";
export { TypedSheet } from "./components/typed-sheet";
export { TypewriterKeyboard } from "./components/typewriter-keyboard";
export { typedViewFixtures } from "./view/typed-view";
export type { CharState, TypedChar, TypedView, TypedViewFixture } from "./view/typed-view";
