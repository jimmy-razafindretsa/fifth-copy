---
id: "0007"
title: One pure, deterministic race engine package shared by server (authority) and client (prediction)
status: proposed
category: architecture
scope: ["packages/engine/**", "src/features/race/**", "services/race-server/src/rooms/**", "services/race-server/src/bots/**"]
supersedes: []
rule: All race rules (text normalisation, continue/block reducers, backspace, WPM/accuracy, ranking, bonus effects, bot typing model, anti-cheat analysis) live in @fifth-copy/engine as pure functions with injected time and randomness; the server applies them as the authority and the client applies the same functions for instant feedback, never its own copy.
---

# 0007. One pure, deterministic race engine package shared by server (authority) and client (prediction)

## Context
Typing must feel instant (every keystroke renders on the next frame) while the server stays the authority (R198). Scores must be identical wherever they are computed: on the server during the race, in the browser for the WPM-through-the-race graph (R141), in the worker when re-analysing a flagged race, in table-driven tests (card #163) and in load tests. Block mode, backspace rules, accents (NFC, card #164) and text-changing bonuses (R131, R132, card #198) make the rules subtle enough that two implementations would drift.

## Decision
- `@fifth-copy/engine` holds every rule as **pure functions over plain data**. No clock, no randomness, no IO: time arrives as the `t` field of each keystroke, randomness as an injected `Rng`. Enforced by `engine-is-pure` (dependency-cruiser) and an ESLint rule that forbids non-relative imports.
- **Reducer shape:** `apply(state, keystroke, text, settings) -> state`. Continue mode, block mode and backspace are separate reducers composed by `settings.errorMode` and `settings.backspace`. States are JSON-serialisable and immutable (new object per step).
- **Per-player text as base + overlay:** every player types the same base text (R37). Bonuses never edit the base: they produce an overlay (`extra` words appended for the leader, `removed` word ranges for the exempted player). `effectiveText(base, overlay)` is what the reducer sees; **clean WPM** is computed over base-text characters only, **bonus-adjusted WPM** over the effective text (R137, card #194). Finish order is by effective text completion; this is the fairness rule card #198 asks for.
- **Scoring:** `wpm = (correctChars / 5) / minutes`, `rawWpm` includes errors, `accuracy = correct / total keystrokes` (R45-R47); unfinished players get the same formulas over elapsed time at their last keystroke or at race end for timer expiry.
- **Ranking:** one comparator (R44): finished by finish time; then `typing|asleep|expired|line-cut` by progress then accuracy; `abandoned` last. Ties by desk number for determinism.
- **Bots:** `nextBotKeystroke(profile, context, rng)` draws per-character delays around the level's WPM with burst-and-pause, error injection and corrections that respect the error mode (R122-R126). The server feeds bot keystrokes through the same reducer as humans (R127).
- **Anti-cheat:** `analyseTrace(keystrokes, text)` returns flags (sustained WPM above cap, inter-key coefficient of variation below a threshold, non-monotonic or implausible timing, sequence not reproducible by the reducer). The server stores flags on the result (R202, R203).
- **Client prediction:** the browser applies the reducer on key down and renders immediately; each 10 Hz snapshot carries the server's authoritative `cursor|correct|errors` per desk; if the local state for *you* diverges, the client re-applies its unacknowledged keystrokes on top of the server state (reconciliation). Rivals are rendered from snapshots only.
- `ENGINE_VERSION` is stored on every race result; a change in scoring bumps it.

## Consequences
- The engine has the project's best test coverage: table-driven cases, property tests (idempotence of normalisation, monotonic progress, comparator antisymmetry), and replayed real traces.
- UI components never compute scores; they display engine output.
- Bots and load tests cost no browser.

## Alternatives considered
- **Server-only rules, client just renders snapshots:** simplest, but 100 ms+ of visible lag on every keystroke on school Wi-Fi. Rejected.
- **Client-authoritative with server audit:** instant and simple, but trivially cheated and the spec forbids it. Rejected.
- **Lockstep simulation:** needs all inputs each tick; a typing race has independent players, so authority plus prediction is enough.
