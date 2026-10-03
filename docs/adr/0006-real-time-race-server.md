---
id: "0006"
title: Real-time races run on a separate Socket.IO server, server-authoritative, 10 Hz snapshots
status: proposed
category: architecture
scope: ["services/race-server/**", "packages/protocol/**", "src/features/race/**", "src/features/lobby/**", "src/app/api/internal/**"]
supersedes: []
rule: Live race traffic goes browser <-> services/race-server over Socket.IO (WebSocket, polling fallback on) with messages declared in @fifth-copy/protocol; the server is the authority, the web app only mints race tokens and persists; the race server never touches Prisma.
---

# 0006. Real-time races run on a separate Socket.IO server, server-authoritative, 10 Hz snapshots

## Context
Thirty to one hundred students type at once; positions must update live (R40, R63, R199) and the server must validate every keystroke (R198, R202). Next.js route handlers cannot hold long-lived sockets (Next.js docs, backend-for-frontend guide), and the spec (section 16.2) mandates a separate Node real-time server with Redis. School networks sometimes block WebSocket upgrades (cards #442, #443). Students must see their own keystrokes instantly even on a slow connection. Covers board cards #149 (framework), #154 (protocol), #165 (token), #173 (ingestion and broadcast).

## Decision
1. **Framework: Socket.IO 4** on a Node 24 process in `services/race-server`. Reasons: built-in long-polling fallback for school networks, rooms, acknowledgements, automatic reconnection on the client, Redis adapter available if a second node is ever needed, and bots can join through the same server-side code path. Transport order: WebSocket first, polling fallback allowed.
2. **Topology:** one race-server process per deployment. A room lives on exactly one process. Horizontal scaling (Redis adapter plus sticky routing by room) is a later, additive step.
3. **Authority:** the race server owns the live room (membership, host, countdown, clock, progress, ranking, bonuses, idle, grace periods, anti-cheat flags). The browser sends keystrokes and shows what the server says; it also runs the shared engine locally for instant feedback and reconciles against server snapshots (ADR 0007).
4. **Protocol:** every event, token and internal payload is a zod schema in `@fifth-copy/protocol`, parsed at the receiving edge. Client -> server: `join`, `keys` (batched keystrokes, up to 50 ms), `abandon`, `host:start`, `host:kick`, `ping`. Server -> client: `welcome` (room, text, your desk), `snapshot` (10 Hz, compact arrays keyed by desk), `event` (overtake, passed, new-host, line-cut, asleep, bonus), `ended` (results), `rejected` (reason). `PROTOCOL_VERSION` is sent in the handshake; a mismatch is rejected and the client reloads.
5. **Access:** the web app mints a short-lived **race token** (HS256 JWT, 5 min, claims: user id, display name, avatar flag, lobby id, role host|player|spectator, `v`) signed with `RACE_TOKEN_SECRET`; the race server verifies it in the handshake. The race server never reads the session cookie.
6. **Web <-> race server internal API** (HTTP, HMAC-signed with the same secret, both directions): web -> race `POST /internal/rooms` (open a room for a lobby), `PATCH /internal/rooms/:id/settings`, `POST /internal/rooms/:id/close`; race -> web `POST /api/internal/races` (start: web generates the text, creates the Race row, returns text and settings), `POST /api/internal/races/:id/results` (end: per-player results and keystroke blobs), `POST /api/internal/lobbies/:id/host` (host transfer record). Idempotent, retried from a Redis outbox (ADR 0008).
7. **Rates:** keystroke batches every 50 ms at most, snapshots at 10 Hz, per-socket rate limit and payload cap (card #177). Snapshots are full state, not deltas, so a lost packet never desynchronises a client.
8. **Spectators** join the same room on a `spectator` channel (read-only, no desk), used by the projector and phones.
9. **Draining:** `GET /health` reports live rooms and `draining`; `SIGTERM` stops new rooms and lets live races finish (ADR 0012).

## Consequences
- Two processes to run locally (`npm run dev` and `npm run dev:race`) and to deploy. Compose and CI already carry Redis.
- Any change to a wire shape is a change to `@fifth-copy/protocol` plus both sides; the version bump makes stale clients reload instead of misbehaving.
- Load tests are server bots in a room (R128); no browser needed.

## Alternatives considered
- **Colyseus:** rooms, state sync and reconnection come built in, but its binary schema sync fights per-player text overlays and the "all text in HTML" rule, it has no long-polling fallback, and its matchmaker duplicates the lobby model we must keep in Postgres. Rejected.
- **Raw `ws`:** smallest dependency, but we would rewrite reconnection, acknowledgements, rooms and the polling fallback. Rejected.
- **Next.js custom server hosting Socket.IO in-process:** one process, but it disables standalone output, couples web deploys to live races, and the spec forbids it. Rejected.
- **Managed real-time (Ably, Pusher, PartyKit, Durable Objects):** the authority logic still needs compute, the spec requires hosting on our own domain, and minors' data would leave our server. Rejected.
