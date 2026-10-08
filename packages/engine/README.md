# @fifth-copy/engine

Governing ADR: `docs/adr/0007-shared-race-engine.md`. Architecture: `docs/architecture/ARCHITECTURE.md` section 6.

The engine is the one place that knows how a race is scored. The race server runs it as the authority; the browser runs the same code for instant feedback and prediction; tests and load tools replay keystroke traces through it.

## Rules
- Pure functions over plain data. No `Date.now()`, no `Math.random()`, no imports from `node:*`, `react`, `next`, `socket.io`, Prisma or `zod`. Time and randomness are parameters (see `Rng` and the `t` field of a keystroke).
- Deterministic: the same `(state, input)` always yields the same output. Reducers return new objects; they never mutate their inputs.
- Unicode: compare NFC-normalised strings (`normalizeTypeable`); never assume one code unit per character.
- Every exported function has table-driven unit tests next to it (`*.test.ts`).
- Bump `ENGINE_VERSION` on any change that alters scores, ranking or text handling; results store the version they were computed with.

## Modules
Landed (re-exported from `src/index.ts`; `ENGINE_VERSION` 0.4.0):
- `text/`: `normalizeTypeable(s)` (NFC, look-alike map, typeable whitelist `TYPEABLE` / `isTypeable`: printable ASCII, French letters and `« » €`, whitespace collapse, trim; idempotent; BMP-only, so `text[i]` is the i-th character), `wordCount(s)`, `charsOf(text)`.
- `text/overlay`: per-desk overlays (ADR 0007, 0016): `TextOverlay = { extra, removed }`, `wordsOf(text)` (split on single spaces, round-trips), `effectiveText(base, overlay)` (base words minus `removed` indexes, then `extra`), `baseLengthOf` (the base part, for clean WPM), `untypedBaseWords(base, overlay, reach)` (base words after the word at the desk's high-water mark: removing them never changes a reached character, so the trace replays on the new text).
- `reducers/`: `applyKeystroke(state, keystroke, text, settings)` (the only dispatcher) composed from `continueMode`, `blockMode`, `backspace`; `PlayerState`, `initialState()`. `text` must already be normalised; rejected keystrokes return the same state reference; `typed.length === cursor`.
- `scoring/`: `wpm`, `rawWpm` (5-character words over an injected `elapsedMs` since GO, `0` when no time passed), `accuracy` (`correct / total`, Backspace presses count in `total`, `1` when nothing pressed), `progress(state, textLength)` (`1` when finished), `elapsedFor(state, raceElapsedMs)` (`finishedAt` for finishers; callers pass `state.lastT` for asleep/abandoned/expired/line-cut and the race end only for a typing player at timer expiry, ADR 0007).
- `scoring/cleanAndAdjustedWpm(state, base, overlay, elapsedMs)`: clean = correct characters of the base part / 5 / minutes, adjusted = `wpm` over the effective text (ADR 0016: clean is shown).
- `bonus/`: `BONUS_RULES[kind] = { threshold, hostile, targets, effect }` (one row per `BonusKind`), `rankPct`, `eligibleBonus(pct, n)` (leader and `n < 3`: null; 0.75 smoke-break, 0.67 exemption, 0.5 extra-paperwork, inclusive), `applyBonus(kind, input)` (targets from the live order: typing desks only, never the sender for a hostile kind, immune ones dropped; null = refused, card kept), `canPlay` (`COOLDOWN_MS` 15 000, shared across kinds), `canHit` (repeat immunity, hostile kinds only), ledger `record(ledger, desk, event)` (sent, received from others, one `BonusLogEntry` per (from, to), at most `MAX_LOG_ENTRIES`).
- `trace/`: `traceCapOf(textLength)` (`TRACE_KEYS_PER_CHAR` 4 per text character + `TRACE_ALLOWANCE` 1 000): the most keystrokes one desk's trace holds; the race server stops tracing beyond `traceCapOf` of the desk's effective text; the web, which stores no overlay yet (#623), refuses a stored trace above `traceCapOf(base)` plus the largest Extra Paperwork overlay (`maxStoredTraceKeys`, #190).
- `anticheat/`: `analyseTrace(input, thresholds = DEFAULT_THRESHOLDS) -> Flag[]` (#195): `input = { keystrokes, text (normalised), settings, recorded: { cursor, correct, errors }, timingAnomalies }`; one replay through `applyKeystroke` (also `replayTrace`), then the `RULES` in a fixed order: `non-monotonic`, `unreproducible` (replay differs from `recorded`), `wpm-cap` (10 s windows, >= 20 keys), `regular-rhythm` (>= 50 non-backspace keys: CV below 0.12 or > 90 % of intervals within +-2 ms), `timing-anomalies` (> 20, or > 5 % of keys from 50 keys). Every rule O(n). `detail` holds numbers only. Fixtures in `anticheat/fixtures/` come from `scripts/trace-fixtures.ts` (seeded; no real data). `mulberry32` is re-exported for that script.
- `ranking/`: `Rankable`, `compareResults(a, b)` (exactly -1/0/1, strict total order with unique desks: finished by `finishedAt`; typing/line-cut/expired/asleep by progress then accuracy; abandoned last; ties by desk), `rank(list)` (new array), `placeOf(list, desk)` (1-based, `0` if absent).

Planned (one card each; see `docs/architecture/ARCHITECTURE.md` section 11): `bots/` typing model (injected RNG).
