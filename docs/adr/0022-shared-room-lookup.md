---
id: "0022"
title: The web app asks the race server whether two users share a live room; lobby-scoped access never reads Redis room keys
status: proposed
category: architecture
scope: ["src/app/api/avatars/**", "src/features/lobby/queries/share-lobby.ts", "src/features/identity/queries/avatar-file.ts", "src/server/internal-api/client.ts", "services/race-server/src/http/internal.ts", "packages/protocol/src/internal.ts"]
supersedes: []
rule: A web-side rule that depends on who is in a live room asks the race server through the signed POST /internal/rooms/shared (two user ids in, one boolean out) and treats no answer as "not shared"; the web app never reads room:* keys and keeps no copy of live membership; a refusal looks the same whether or not the lobby, the user or the resource exists.
---

# 0022. The web app asks the race server whether two users share a live room; lobby-scoped access never reads Redis room keys

## Context
Avatars are visible only to their owner and to people who share a lobby with them (R163). ADR 0009 puts them behind a route that checks lobby membership; ADR 0014 makes `GET /api/avatars/[userId]` the only reader, authorisation first, every refusal a 404. The route runs in the web app, but the web app has no record of who is in an open lobby: ADR 0008 gives live membership to the race server (Redis hash `room:<lobbyId>:members`, keyed by user id, no per-user index), and Postgres knows only the host (`Lobby.hostUserId`) and, after a race, who raced (`RaceResult.userId`). Card #65 stopped on this gap (builder HANDOFF 2026-11-10). The owner chose on 2026-11-10: the web asks the race server over the signed internal API; the race server stays the owner of membership; ADR 0008 is unchanged.
Paths: `packages/protocol/src/internal.ts`, `services/race-server/src/http/internal.ts`, `services/race-server/src/rooms/registry.ts`, `src/server/internal-api/client.ts`, `src/features/lobby/queries/share-lobby.ts`, `src/app/api/avatars/[userId]/route.ts`.

## Decision
- **Route.** ADR 0006 point 6 gains one web -> race server route on the recipe of `POST /internal/rooms/status` (#806) and `POST /internal/rooms/type` (#815): `POST /internal/rooms/shared`, request `sharedRoomRequestSchema { v, userIds: [a, b] }` (two different ids), response `sharedRoomResponseSchema { v, shared: boolean }`, both in `@fifth-copy/protocol`, one `PROTOCOL_VERSION` bump. Same HMAC, timestamp, nonce and version checks as every internal route; nothing about signing or tokens changes.
- **Answer.** `shared` is true when at least one room's members hash holds both ids, in any phase. Bots (`bot:<desk>` keys) and spectators are never members. The race server reads its own Redis state (the `rooms` set, then one pipelined HEXISTS pair per open room); the route is read only, writes no key, refreshes no TTL and answers while draining.
- **Minimal disclosure.** The response is the boolean alone: no lobby id, code, phase, name or count, and the log line carries the path, status and outcome only. The web learns "these two share a room", never which room or who else is in it.
- **Web side.** `InternalApiClient.sharedRoom` is the only caller of the route and `shareLobby(viewerId, ownerId)` in `features/lobby` (exported from `server.ts`, ADR 0021) is the only caller of the client method. `shareLobby` is true when the race server says `shared: true`, or when both users have a `RaceResult` on one `Race` that ended less than 24 h ago (Postgres, the durable record of ADR 0008; it covers the Dawn report after the sockets closed).
- **Fail closed.** A timeout (`INTERNAL_TIMEOUT_MS`), a non-200 or an unparsable body counts as "not shared". An avatar is then served only to its owner and to recent race mates; callers fall back to initials.
- **No oracle.** For a viewer who is not the owner, the rule is evaluated before the avatar's row or file is read, and every refusal is the same 404, so a non-member cannot tell a missing avatar, a missing user or a lobby they are not in from one another. Anonymous viewers are refused without a lookup.
- **No cache.** One lookup per non-owner avatar request. A positive cache would outlive a leave or a kick; a negative one would hide a member who just joined. The cost is bounded by the shared limiter (`avatar-view`, per viewer, ADR 0020) and by the browser's private cache of a served image (ADR 0014 headers, one request per avatar version and size).
- This extends ADR 0006 (one more internal route) and ADR 0009/0014 (the membership check they call for); it changes nothing in ADR 0008: Redis room state is still read and written by the race server only, and nothing durable is added to Redis.

## Consequences
- Lobby-scoped rules on the web have one source of truth and no second copy of membership to keep in step with joins, leaves, kicks, voids and TTL expiry.
- Each non-owner avatar request costs one signed HTTP call and, on the race server, two HEXISTS per open room in one pipeline. That is linear in open rooms: fine for one deployment's rooms (ARCHITECTURE 7.9; a full 30-desk roll is at most 29 lookups per member, once per avatar version). If rooms ever number in the thousands, the race server adds a per-user index behind the same wire shape; the web does not change.
- When the race server is down or draining slowly, lobby mates see initials instead of portraits until it answers. Accepted: refusing is the safe side for minors' pictures.
- The internal API now answers a membership question. It stays unreachable without `RACE_TOKEN_SECRET`; the body is deliberately too small to enumerate rooms.
- Forbidden: reading `room:*` keys from the web app, moving the room key layout into `@fifth-copy/protocol`, widening the response beyond the boolean, answering "shared" on an error, and serving an avatar to a non-owner without going through `shareLobby`.

## Alternatives considered
- **(a) The web records a member set when `mintRaceToken` succeeds** (Redis, lobby- and user-indexed, 24 h TTL): a second copy of membership, written at mint and not at join, never updated on leave, kick or void, and an amendment to ADR 0008's ownership table. Rejected.
- **(b) The web reads the race server's members hash:** the key layout would move into `@fifth-copy/protocol` and two processes would depend on it; breaks ADR 0008 (the web never reads the room's keys). Rejected.
- **A Postgres membership table written through an internal route on every join and leave:** durable writes for presence, an outbox on the hot join path, and stale rows after a Redis loss. Rejected.
- **A per-user room index in Redis now:** O(1) lookups, but new keys to keep consistent on join, leave, close, void and expiry for a cost that does not exist at this scale. Deferred behind the same wire shape.
- **Lobby id in the avatar URL so the lookup is one HEXISTS pair:** the client would name the lobby, the URL would change with every room and the route would leak which lobby ids exist to anyone probing. Rejected.
- **Caching the answer in the web app:** see "No cache". Rejected.
