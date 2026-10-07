/**
 * @fifth-copy/protocol: the single definition of every wire message (socket events, race tokens,
 * internal HTTP payloads, host race settings). Parse at the edge with these schemas; never trust raw input.
 * See packages/protocol/README.md and docs/adr/0006-real-time-race-server.md.
 */
export * from "./version";
export * from "./room-code";
export * from "./race-token";
export * from "./socket";
export * from "./internal";
export * from "./settings";
