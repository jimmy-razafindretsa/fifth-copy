---
id: "0023"
title: Population statistics are server-side aggregates of typists with 3 counted races, smoothed, shown only from 30 typists, with no count or identity
status: proposed
category: security
scope: ["src/features/stats/queries/get-census.ts", "src/features/stats/view/census.ts", "src/features/stats/view/census-fixtures.ts", "src/features/stats/queries/counted-where.ts"]
supersedes: []
rule: A statistic about other typists leaves the server only as the output of one pure function over the counted population (typists with at least 3 counted results, at least 30 of them, each smoothed by a fixed kernel); a response never holds a head count, a count per bar, an id, a name or another typist's figure.
---

# 0023. Population statistics are server-side aggregates, smoothed, with a 30-typist floor and no count or identity

## Context
Until now every stats read was about the viewer alone (ADR 0008: the Personnel file and the missions read the viewer's own `RaceResult` rows through `countedWhere`). Bible 14.3 keeps a section, `Ta place au Ministère`, waiting for a "population read and privacy decision": where a typist stands among all typists for speed and accuracy. Users are students aged 12 to 17 and a population can be one class, so "no names" is not enough: a count, a lone bar at the top of a histogram or the population size can point to one known classmate.
The owner approved aggregate population statistics on 2026-11-16 (recorded on epic #959) on three conditions: aggregates only, nobody else identifiable, a minimum population. Card #966 builds the read; #967 the section.
Paths: `src/features/stats/queries/get-census.ts`, `src/features/stats/view/census.ts`, `src/features/stats/queries/counted-where.ts`, `docs/privacy/inventory.md`, `docs/privacy/pia.md`.

## Decision
- **Who counts.** A typist is any user, account or guest (ADR 0009), with at least 3 counted results: the `countedWhere` rule without the user (`countedPopulationWhere`: no bot, no flagged result, no voided race). A viewer under 3 counted races gets the shapes but no place.
- **One read, one function.** `getCensus` reads the population with one grouped aggregate (average and best clean WPM, ADR 0016; average and best accuracy), drops the ids on the spot and hands the four numbers per typist to the pure `censusOf`. Only its result, a `Census` or `null`, leaves the module; the population read is private. Everything is computed on the server; the browser never receives per-typist data.
- **Floor.** Under 30 typists (`CENSUS_MIN_POPULATION`) the census is `null`: nothing shows.
- **Smoothing.** Each typist is spread by a fixed Gaussian kernel (4 WPM, 0.8 accuracy point) over 60 bars (0 to 150 WPM, 80 to 100 %; outside values sit on the end), so a lone typist raises several bars and no bar stands for one person. Deterministic, no noise: the same population gives the same shapes.
- **No counts, no identities.** A response holds bar heights relative to the tallest bar, cumulative shares, the scale ends and the viewer's own value, position and percentile (share of the smoothed population strictly under them, one decimal, never 100). No head count, no count per bar, no id, no name, no figure of another typist; shapes are rounded fractions, so the population size cannot be read back. A test lists the result's keys, deep, against an allow-list.
- **Freshness.** The population read is memoised in process for 10 minutes; the viewer's own figures are read fresh. The read is one function, so a snapshot table can replace it later without touching the view.

## Consequences
- Any future population statistic (another measure, another scope) follows this rule or supersedes this ADR; a class, lobby or leaderboard scope is out (it would shrink the population under the floor or name people).
- The privacy page, `docs/privacy/inventory.md` ("Race results") and `docs/privacy/pia.md` (flow and risk 20) name this use.
- ADR 0008 is unchanged: the census reads stored `RaceResult` rows only, never raw keystrokes. ADR 0009 is unchanged: guests are typists too.

## Alternatives considered
- Raw histograms with counts per bar: a bar of 1 at the top of a class is a named student. Rejected.
- Differential-privacy noise: random output is hard to test and explain to students; smoothing plus the floor and no counts meets the owner's conditions deterministically.
- Class or lobby scope: populations of 20 to 35 sit at or under the floor and make every student guessable. Out of scope.
- A stored snapshot table: more moving parts than needed now; kept as the extension point behind the memo.
