---
id: "0024"
title: Per-key history is daily character and letter-pair aggregates with summed timing, rolled up from a marker on RaceKeystrokes
status: accepted
category: data
scope: ["prisma/schema/stats.prisma", "prisma/schema/race.prisma", "src/features/stats/jobs/**", "src/features/results/merge-steps.ts", "docs/privacy/retention.md"]
supersedes: []
rule: Only RaceKeystrokes ever holds a keystroke or a per-race key record; per-key history lives in CharStatDaily and BigramStatDaily as daily sums (hits, errors, timedHits, totalMs) keyed by the America/Toronto stats day, rolled up once per RaceKeystrokes row (rolledUpAt), merged by summing; letter-pair rows are kept 90 days.
---

# 0024. Per-key history is daily character and letter-pair aggregates with summed timing

## Context
ADR 0008 keeps raw keystrokes 30 days as a gzip blob per desk (`RaceKeystrokes`) and rolls them up daily into `CharStatDaily (user, date, char, layout, hits, errors, avgMs)` in America/Toronto. The Personnel file graphs (epic #959, owner decision 2026-11-16) also need the reference's letter-pair docket, and the rollup (#314) needs to know which blobs it already counted. An average (`avgMs`) cannot be added to another day's or another typist's average, so a re-run, an on-demand rollup after a race and the guest merge (ADR 0009) would all have to recompute from raw keys that may already be gone. Card #312 lands the model; #314 writes it, #315 purges it, #961 reads it.

## Decision
- **Two daily tables, both in `prisma/schema/stats.prisma`.** `CharStatDaily`: one row per user, stats day, expected character (one NFC character, lower case) and keyboard layout. `BigramStatDaily`: one row per user, stats day and expected letter pair (two lower-case letters). Field lists live only in the schema file.
- **Summed timing.** Each row holds `hits`, `errors`, `timedHits` and `totalMs`. ADR 0008's `avgMs` is read as `totalMs / timedHits`. Sums make every combination exact: two rollups of one day, the merge of a guest into an account, a week built from seven days.
- **Stats day.** `day` is a SQL `date` holding the `src/lib/time.ts` day key (America/Toronto), as ADR 0008 says.
- **Rollup marker.** `RaceKeystrokes.rolledUpAt` (null = not counted yet, indexed with `createdAt`) makes the rollup idempotent: a blob is added once, in the same transaction that sets the marker. The 30-day purge of the blob does not depend on it.
- **No keystroke outside `RaceKeystrokes`.** No other table ever holds a keystroke, a key timing list or a per-race key record; the stats tables hold only per-day sums.
- **Retention.** `CharStatDaily` follows the account (ADR 0008, `docs/privacy/retention.md`). `BigramStatDaily` is kept 90 days (#315): the docket shows recent habits, and a pair table grows faster than a character table.
- **Guest merge.** A guest's rows move to the account; on a key clash the four counts are added (one `INSERT .. ON CONFLICT` per table in the results feature's merge steps, ADR 0009).

## Consequences
- ADR 0008 is unchanged and holds: raw keys 30 days, daily rollup, Toronto day, stats reads never touch raw keystrokes. This ADR adds the second table, the summed timing, the marker and the 90-day period.
- A later dimension (language, mode) is an additive column with a default and joins the unique key in an expand card.
- The privacy inventory and retention schedule list both tables; the privacy page names the 90-day period when the card that shows the docket ships.

## Alternatives considered
- `avgMs` as in ADR 0008: averages do not add up across rollups or merges.
- One table with a `kind` column for characters and pairs: mixes two keys (layout matters for a character, not for a pair) and two retention periods.
- Re-rolling a whole day from raw keys instead of a marker: breaks once the 30-day purge removed the blobs, and doubles work after each race.
- Per-race key rows: a keystroke record outside `RaceKeystrokes` that outlives the 30-day limit.
