# @fifth-copy/protocol

Governing ADR: `docs/adr/0006-real-time-race-server.md`. Architecture: `docs/architecture/ARCHITECTURE.md` sections 7 and 8.

Every message that crosses a process boundary is declared here once, as a zod schema, and parsed at the receiving edge. Nothing else may define wire shapes.

## Rules
- Schemas only: zod, types, constants. No IO, no React, no Node APIs, no Prisma. May import types from `@fifth-copy/engine`.
- One schema per message; discriminated unions `ClientToServer` and `ServerToClient` for socket events; `RaceToken` claims; `Internal*` payloads for the web <-> race-server HTTP API; `RaceSettings` (host settings form, lobby record and room config share it).
- Backwards compatibility is not a goal: bump `PROTOCOL_VERSION`, the handshake rejects mismatches and the client reloads (version skew after a deploy).
- Keep snapshots compact: arrays of numbers keyed by desk id, not objects per player (10 Hz x 100 players).

## Modules
`version.ts` (`PROTOCOL_VERSION`, now 4) · `room-code.ts` (`ROOM_CODE_RE`, `formatRoomCode`, `parseRoomCode`) · `race-token.ts` (claims, `RACE_TOKEN_TTL_S`) · `race.ts` (race value schemas) · `events.ts` (race events) · `socket.ts` (handshake, welcome/roster, event maps) · `internal.ts` (web <-> race-server HTTP) · `settings.ts` (race settings).

Bounds: every string and array is capped (`MAX_DESKS` 256, `MAX_NAME_LENGTH` 64, `MAX_TEXT_LENGTH` 20 000, `MAX_OVERLAY_WORDS` 500, ids 128, token 4096, `MAX_KEYS_PER_BATCH` 64, `MAX_RESULTS_PER_REQUEST` 25, `MAX_TRACE_BASE64_LENGTH` 256 KiB). Times are integer ms: `t`, `lastT`, `kickAt`, `blurUntil`, `finishedAt`, `durationMs` since GO, capped at `MAX_RACE_MS` (1 h: the timer stops at 600 s, an untimed 500-word text at 10 WPM takes 50 min); `t0`, `serverNow`, `startedAt`, `endedAt` server epoch. Names and keys are printable: no control, format (bidi), surrogate, private-use or line-separator code points (names keep ZWJ/ZWNJ).

## Socket handshake and events
- Client connects with `auth: { v, token, resumeKey? }` (`handshakeAuthSchema`); `token` is the race token (HS256 JWT, `jose`, claims `{ v, sub, name, lobby, role: host|player|spectator }` + `iat`/`exp`, 300 s), fetched by a server action, never put in a URL. `resumeKey` (32-64 URL-safe chars, from a previous `welcome`) reclaims a desk after a line cut (ARCHITECTURE 7.4, #178).
- Refusal: Socket.IO `connect_error` whose message is a `rejectReasonSchema` value: `version`, `bad-token`, `no-room`, `closed`, `in-progress` (room past `waiting`, no resume key).
- Temporary refusal: a valid `spectator` token is refused as `bad-token` until the spectator channel lands (#187).
- `Member = { desk, name, isHost, isBot, color: 0..11, marker }`; `color`/`marker` are always `deskIdentity(desk)` (colour `(desk - 1) % 12`, marker `circle|square|triangle|diamond` every 12 desks), a pure function both sides call.

### Server -> client (`serverEvents`, typed as `ServerToClientEvents`)
- `welcome { v, role, you: desk | null (spectator), room: { code, phase }, members, settings, race: RaceInfo | null, state: PlayerState | null, overlay: TextOverlay | null, resumeKey | null, serverNow }` once after the handshake (and after a resume). `phase`: `waiting|countdown|running|ended`. `RaceInfo = { raceId, text, language, wordCount, t0, timerS }`.
- `roster { v, members }` on every membership change; `settings { v, settings }` (full `RaceSettings`) after a host change.
- `countdown { v, race: RaceInfo }` when the host starts.
- `snapshot { v, t, desks: [desk, cursor, correct, errors, statusCode][], ranks: desk[] }` at 10 Hz; `statusCode` indexes `PLAYER_STATUSES` (engine order, `PLAYER_STATUS_CODES` is the reverse map).
- `event { v, kind, ... }` (`eventSchema`, discriminated on `kind`): `finished {desk, place}`, `overtake {desk, passed}`, `passed {desk, by}`, `new-leader {desk}`, `new-host {desk}`, `line-cut {desk}`, `resumed {desk}`, `idle-warning {desk, kickAt}`, `asleep {desk}`, `abandoned {desk}`, `kicked {desk}`, `bonus-earned {desk, bonus}`, `bonus-sent {from, to: desk[], bonus}`, `bonus-hit {desk, bonus, overlay | null, blurUntil | null}`. `bonus`: `extra-paperwork|exemption|smoke-break`. `TextOverlay = { extra: words appended, removed: base word indexes }` (ADR 0007).
- `ended { v, raceId, reason: all-finished|timer|void, ranking: RankingEntry[] }`, `RankingEntry = { place, desk, name, isBot, status, wpm, rawWpm, accuracy, progress, finishedAt | null }`.
- `rejected { v, reason: before-go|not-running|spectator|rate-limit|no-bonus }`: refusal of an ack-less event.
- `pong { v, sent, serverNow }`.

### Client -> server (`clientEvents` + `clientAcks`, typed as `ClientToServerEvents`)
- `host:settings { v, patch: RaceSettingsPatch }`, ack `hostSettingsAckSchema`: `{ ok: true, settings } | { ok: false, error: not-host|not-waiting|invalid|no-room }`.
- `host:start { v }`, ack `hostStartAckSchema`: `{ ok: true, raceId } | { ok: false, error: not-host|too-few|not-waiting|start-failed }`.
- `keys { v, batch: Keystroke[] (1..64) }`: `Keystroke = { t: ms since GO, key: one character or "Backspace" }`; `t` need not be monotonic (the server clamps). `abandon { v }`, `bonus:play { v }`, `ping { v, sent }`: no ack, refused by `rejected`.
- A new event = one schema in `clientEvents` (+ its ack in `clientAcks` if it has one); both event types are derived from the maps, never hand-written.

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
- Reject `|now - timestamp| > INTERNAL_MAX_SKEW_S` (300 s) as `stale-timestamp`; errors are `internalErrorSchema` (`bad-signature`, `stale-timestamp`, `bad-body`, `version`, `not-found`, `conflict`).
- `POST /internal/rooms` (web -> race server): `openRoomRequestSchema { v, lobbyId, code, hostUserId, settings: RaceSettings }` (the room keeps the first open's settings) -> `openRoomResponseSchema { v, roomId, phase: "waiting", created }`.
- `POST /api/internal/races` (race server -> web, on `host:start`): `startRaceRequestSchema { v, raceId (uuid v4, chosen by the race server: idempotent), lobbyId, hostUserId, settings, desks: { desk, userId | null (bot), name, isBot }[] }` -> `startRaceResponseSchema { v, raceId, text: { content, language, wordCount, sourceRef | null }, settings, startedAt }`. No `engineVersion` on the wire: the web stamps its own `ENGINE_VERSION` (same deploy, ADR 0012).
- `POST /api/internal/races/:id/results` (race server -> web, at race end, never for a void race): `raceResultsRequestSchema { v, raceId, endedAt, reason: all-finished|timer, lobbySize, results: InternalRaceResult[] (1..25) }` -> `raceResultsResponseSchema { v, raceId, persisted: desk[] }`. `internalRaceResultSchema` = desk, user (`null` for bots), place, engine `status` (`typing` = timed out), WPM (`wpm`, `rawWpm`, `cleanWpm`, `adjustedWpm`), `accuracy`/`progress` in [0, 1], counters, `durationMs`, `finishedAtMs`, bonus counts and `bonusLog`, anti-cheat `flags`, `engineVersion`, `trace { encoding: "gzip+base64", data, count }` (ADR 0008).
- `INTERNAL_HMAC_TEST_VECTOR` is a known answer: signer and verifier tests both assert it.
