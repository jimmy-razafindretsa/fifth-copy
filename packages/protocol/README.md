# @fifth-copy/protocol

Governing ADR: `docs/adr/0006-real-time-race-server.md`. Architecture: `docs/architecture/ARCHITECTURE.md` sections 7 and 8.

Every message that crosses a process boundary is declared here once, as a zod schema, and parsed at the receiving edge. Nothing else may define wire shapes.

## Rules
- Schemas only: zod, types, constants. No IO, no React, no Node APIs, no Prisma. May import types from `@fifth-copy/engine`.
- One schema per message; discriminated unions `ClientToServer` and `ServerToClient` for socket events; `RaceToken` claims; `Internal*` payloads for the web <-> race-server HTTP API; `RaceSettings` (host settings form, lobby record and room config share it).
- Backwards compatibility is not a goal: bump `PROTOCOL_VERSION`, the handshake rejects mismatches and the client reloads (version skew after a deploy).
- Keep snapshots compact: arrays of numbers keyed by desk id, not objects per player (10 Hz x 100 players).

## Modules
`version.ts` (`PROTOCOL_VERSION`, now 3) · `room-code.ts` (`ROOM_CODE_RE`, `formatRoomCode`, `parseRoomCode`) · `race-token.ts` (claims, `RACE_TOKEN_TTL_S`) · `socket.ts` (handshake, events) · `internal.ts` (web <-> race-server HTTP) · `settings.ts` (race settings).

## Socket handshake and events
- Client connects with `auth: { v, token }` (`handshakeAuthSchema`); `token` is the race token (HS256 JWT, `jose`, claims `{ v, sub, name, lobby, role: host|player }` + `iat`/`exp`, 300 s), fetched by a server action, never put in a URL.
- Refusal: Socket.IO `connect_error` whose message is a `rejectReasonSchema` value: `version`, `bad-token`, `no-room`, `closed`.
- Server -> client (`serverEvents`, typed as `ServerToClientEvents`): `welcome { v, you: desk, room: { code, phase: "waiting" }, members, settings }` once after the handshake; `roster { v, members }` on every membership change; `settings { v, settings }` (full `RaceSettings`) after a host change. `Member = { desk, name, isHost }`.
- Client -> server (`clientEvents` + `clientAcks`, typed as `ClientToServerEvents`): `host:settings { v, patch: RaceSettingsPatch }` with an ack `{ ok: true, settings } | { ok: false, error: "not-host" | "not-waiting" | "invalid" | "no-room" }` (`hostSettingsAckSchema`). A new event = one schema in `clientEvents` + its ack in `clientAcks`; both event types are derived from the maps.

## Race settings (`settings.ts`)
`raceSettingsSchema` is one strict object (unknown keys rejected); later cards add fields, never rename them. `DEFAULT_RACE_SETTINGS` is the only place defaults live.
- Text: `language` (`fr`|`en`, independent of the UI locale), `textType` (`sentences`|`words`|`special-characters`), `wordCount` (int 10-500), `accentEveryWord`.
- Difficulty: `{ level: easy|normal|hard }` or `{ level: "custom", wordLength, rareLetters, punctuationDensity }`.
- Content: `practiceLetters` (<= 12 distinct single NFC characters), `includeNumbers`, `includeSymbols`, `includePunctuation`.
- Race rules: `timerS` (int 60-600 or `null`), `errorMode` (engine `ErrorMode`), `backspace`, `bonuses`; `engineSettingsOf()` returns the engine's `{ errorMode, backspace }`.
- Bots: `bots: { level }[]`, at most `MAX_BOTS` (29); `BOT_LEVEL_WPM` maps `recruit|clerk|officer|commissar|major` to 20-90 WPM.
- Lobby: `lobbyType` (`public`|`private`), owned by `Lobby.type` in Postgres, so `raceSettingsPatchSchema` (the `host:settings` patch: every field optional) omits it.
- `withDefaults(partial)` merges over the defaults and parses (throws on invalid input).
- Storage: the race server keeps them as JSON in the room hash (`settings` field) under the room TTL.

## Internal HMAC API
- Headers: `x-fc-timestamp` (unix seconds) and `x-fc-signature` (`INTERNAL_HEADERS`).
- Signature: lowercase hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` keyed by `RACE_TOKEN_SECRET`; compare in constant time over the raw bytes, before parsing.
- Reject `|now - timestamp| > INTERNAL_MAX_SKEW_S` (300 s) as `stale-timestamp`; errors are `internalErrorSchema` (`bad-signature`, `stale-timestamp`, `bad-body`, `version`).
- `POST /internal/rooms` (web -> race server): `openRoomRequestSchema { v, lobbyId, code, hostUserId, settings: RaceSettings }` (the room keeps the first open's settings) -> `openRoomResponseSchema { v, roomId, phase: "waiting", created }`.
- `INTERNAL_HMAC_TEST_VECTOR` is a known answer: signer and verifier tests both assert it.
