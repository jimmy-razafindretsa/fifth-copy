# @fifth-copy/protocol

Governing ADR: `docs/adr/0006-real-time-race-server.md`. Architecture: `docs/architecture/ARCHITECTURE.md` sections 7 and 8.

Every message that crosses a process boundary is declared here once, as a zod schema, and parsed at the receiving edge. Nothing else may define wire shapes.

## Rules
- Schemas only: zod, types, constants. No IO, no React, no Node APIs, no Prisma. May import types from `@fifth-copy/engine`.
- One schema per message; discriminated unions `ClientToServer` and `ServerToClient` for socket events; `RaceToken` claims; `Internal*` payloads for the web <-> race-server HTTP API; `RaceSettings` (host settings form, lobby record and room config share it).
- Backwards compatibility is not a goal: bump `PROTOCOL_VERSION`, the handshake rejects mismatches and the client reloads (version skew after a deploy).
- Keep snapshots compact: arrays of numbers keyed by desk id, not objects per player (10 Hz x 100 players).
