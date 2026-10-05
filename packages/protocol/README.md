# @fifth-copy/protocol

Governing ADR: `docs/adr/0006-real-time-race-server.md`. Architecture: `docs/architecture/ARCHITECTURE.md` sections 7 and 8.

Every message that crosses a process boundary is declared here once, as a zod schema, and parsed at the receiving edge. Nothing else may define wire shapes.

## Rules
- Schemas only: zod, types, constants. No IO, no React, no Node APIs, no Prisma. May import types from `@fifth-copy/engine`.
- One schema per message; discriminated unions `ClientToServer` and `ServerToClient` for socket events; `RaceToken` claims; `Internal*` payloads for the web <-> race-server HTTP API; `RaceSettings` (host settings form, lobby record and room config share it).
- Backwards compatibility is not a goal: bump `PROTOCOL_VERSION`, the handshake rejects mismatches and the client reloads (version skew after a deploy).
- Keep snapshots compact: arrays of numbers keyed by desk id, not objects per player (10 Hz x 100 players).

## Modules
`version.ts` (`PROTOCOL_VERSION`, now 2) · `room-code.ts` (`ROOM_CODE_RE`, `formatRoomCode`, `parseRoomCode`) · `race-token.ts` (claims, `RACE_TOKEN_TTL_S`) · `socket.ts` (handshake, events) · `internal.ts` (web <-> race-server HTTP).

## Socket handshake and events
- Client connects with `auth: { v, token }` (`handshakeAuthSchema`); `token` is the race token (HS256 JWT, `jose`, claims `{ v, sub, name, lobby, role: host|player }` + `iat`/`exp`, 300 s), fetched by a server action, never put in a URL.
- Refusal: Socket.IO `connect_error` whose message is a `rejectReasonSchema` value: `version`, `bad-token`, `no-room`, `closed`.
- Server -> client (`serverEvents`, typed as `ServerToClientEvents`): `welcome { v, you: desk, room: { code, phase: "waiting" }, members }` once after the handshake; `roster { v, members }` on every membership change. `Member = { desk, name, isHost }`.
- Client -> server: none yet (`ClientToServerEvents` is empty). A new event = one schema + one key in the map.

## Internal HMAC API
- Headers: `x-fc-timestamp` (unix seconds) and `x-fc-signature` (`INTERNAL_HEADERS`).
- Signature: lowercase hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` keyed by `RACE_TOKEN_SECRET`; compare in constant time over the raw bytes, before parsing.
- Reject `|now - timestamp| > INTERNAL_MAX_SKEW_S` (300 s) as `stale-timestamp`; errors are `internalErrorSchema` (`bad-signature`, `stale-timestamp`, `bad-body`, `version`).
- `POST /internal/rooms` (web -> race server): `openRoomRequestSchema { v, lobbyId, code, hostUserId }` -> `openRoomResponseSchema { v, roomId, phase: "waiting", created }`.
- `INTERNAL_HMAC_TEST_VECTOR` is a known answer: signer and verifier tests both assert it.
