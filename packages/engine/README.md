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
Landed (re-exported from `src/index.ts`; `ENGINE_VERSION` 0.2.0):
- `text/`: `normalizeTypeable(s)` (NFC, look-alike map, typeable whitelist `TYPEABLE` / `isTypeable`, whitespace collapse, trim; idempotent; BMP-only, so `text[i]` is the i-th character), `wordCount(s)`, `charsOf(text)`.
- `reducers/`: `applyKeystroke(state, keystroke, text, settings)` (the only dispatcher) composed from `continueMode`, `blockMode`, `backspace`; `PlayerState`, `initialState()`. `text` must already be normalised; rejected keystrokes return the same state reference; `typed.length === cursor`.

Planned (one card each; see `docs/architecture/ARCHITECTURE.md` section 11): `text/` per-player overlays (`effectiveText`) · `scoring/` WPM, raw WPM, accuracy, progress · `ranking/` final comparator · `bonus/` eligibility, effects, cooldowns · `bots/` typing model (injected RNG) · `anticheat/` trace analysis.
