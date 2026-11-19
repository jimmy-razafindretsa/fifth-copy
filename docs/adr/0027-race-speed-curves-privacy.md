---
id: "0027"
title: Other players' race speed curves are stored per result and shown only to the race's participants and host
status: proposed
category: data
scope: ["src/features/results/**", "src/app/api/internal/races/**", "src/features/stats/jobs/purge-keystrokes.ts", "prisma/schema/race.prisma", "docs/privacy/**"]
supersedes: []
rule: Another player's speed curve is read only from `RaceResult.wpmSeries` (at most 60 clean-WPM points, written once by the results filing route), only for a viewer with a `RaceResult` in that race or the race's host at race time (`Race.hostUserId`, never the lobby's current host), never for a flagged row, a bot gets a flat line at its stored clean WPM, and no other user's `RaceKeystrokes` is read at request time; the series is cleared by `stats.purge` 30 days after the result.
---

# 0027. Other players' race speed curves (#952)

## Context
#999 C50-C53 (#952): the Dawn report's WPM graph should show more than the viewer's own line: the winner, the last place, any typist of the ranking. The players are students aged 12 to 17 (Law 25, `docs/privacy/inventory.md`). Today the graph replays the viewer's own trace only (`src/features/results/queries/get-race-series.ts`): `RaceKeystrokes` is personal, kept 30 days (ADR 0008), and read only by its owner. The owner delegated the four privacy answers to the Explorer's BRIEF, which took the conservative reading below.

## Decision
- **Audience.** Another player's curve is shown only to a viewer who has a `RaceResult` in that race (a participant, guest or account) and to the race's host (the lobby host when the race started, also when watching, #876). The audience is fixed at race time: `startRace` records the host in `Race.hostUserId`, and the check reads that, never the lobby's current host, so a member who inherits the host role later does not join the audience of earlier races. A race with no recorded host (started before this column, or that host's account deleted: SetNull) is shown to its typists only. Visitors, spectators, link holders and anyone else see no other line. The check runs on the server before any series is read and fails closed (no race, no lobby, no viewer: nothing).
- **Storage, not replay.** The filing route (`POST /api/internal/races/:id/results`, HMAC, ADR 0008) computes each human desk's series once from the trace it already receives (the engine's `wpmSeries`, clean WPM per ADR 0016, at most `MAX_SERIES_POINTS` = 60 `[t, cleanWpm]` points, `t` in ms since GO) and stores it in `RaceResult.wpmSeries`. A request never reads another user's `RaceKeystrokes`; the viewer's own trace is still replayed for their own card (#865).
- **Flagged rows.** A result with an anti-cheat flag (`suspicious`) gets no stored series and its line is never shown to others.
- **Bots.** Bots send no trace: a bot's line is flat at its stored clean WPM, labelled simulated. No wire change.
- **Retention.** `wpmSeries` is cleared (set to null; the result row stays) by the hourly `stats.purge` job 30 days after the result was filed, the period of the raw keystrokes it comes from (`docs/privacy/retention.md`). It goes with the result row when the account is deleted (#81) or an inactive guest is purged (#86). Races filed before #999, and older than 30 days, show no other line.

## Consequences
- The graph of every player costs one column read, no replay, and never touches another student's raw keys.
- Nothing about a student outlives the existing 30-day promise: a curve is a coarser view of the trace and leaves with it.
- A race older than 30 days shows only the summary figures, for everyone.
- The audience check is a pen-test target (#999 `pentest`): a link holder or spectator must get no series.

## Alternatives considered
- Replay other users' traces at request time: reads minors' raw keys for other people and stops working after the purge anyway.
- Show every curve to everyone who can open the report: a link holder or a passer-by would see students' speed through the race.
- Keep the series for the life of the result: a new period for minors' data with no need stated; the summary figures already cover history.
