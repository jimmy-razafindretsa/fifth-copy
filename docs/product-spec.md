# Product spec: FIFTH COPY

Source: description of the former Linear project "fifth copy", copied 2026-10-02. This is the short summary. **The full specification is `docs/spec/fifth-copy-spec.md`** (v1.0, approved) with the art direction in `docs/spec/art-direction.pdf` (text: `docs/spec/art-direction.md`); where they differ from this page, they win. The atomic requirements extracted from both are in `work/plan/fifth-copy-requirements.md`.

FIFTH COPY is a multiplayer typing race for secondary-school students (ages 12-17), played in class like Kahoot. A host (usually the teacher) opens a lobby, students join, and everyone types **the same text** as fast as possible in **French or English**. Positions update live, Mario Kart style, with a visual alert on every overtake. The game is set in a toy-sized Soviet ministry in 1978: each player is a typist at a desk in a round room, watched by the Major. Every race feeds personal statistics (speed over time, accuracy, difficult keys with a keyboard heatmap) so students can see themselves improve.

## Open questions for the human (Analyst: raise before planning)
- Accounts: do students sign in, or join with a nickname + room code only? (Drives auth, stats persistence and privacy for minors.)
- Real-time transport: decided as proposed ADRs 0006 and 0008 (separate Socket.IO race server, Redis live state, web app persists); see `docs/architecture/ARCHITECTURE.md`. A human must accept the ADRs before live-race cards are built.
- Text sources: curated passages per language and age band, or teacher-supplied text?
- Privacy: students are 12-17; data retention and consent rules for stored statistics.
