# Product spec: FIFTH COPY

Source: description of the Linear project "fifth copy" (P-AEG-2, team Aegis), copied 2026-10-02. Linear remains the source of truth for the project description; update this copy when it changes.

FIFTH COPY is a multiplayer typing race for secondary-school students (ages 12-17), played in class like Kahoot. A host (usually the teacher) opens a lobby, students join, and everyone types **the same text** as fast as possible in **French or English**. Positions update live, Mario Kart style, with a visual alert on every overtake. The game is set in a toy-sized Soviet ministry in 1978: each player is a typist at a desk in a round room, watched by the Major. Every race feeds personal statistics (speed over time, accuracy, difficult keys with a keyboard heatmap) so students can see themselves improve.

## Open questions for the human (Analyst: raise before planning)
- Accounts: do students sign in, or join with a nickname + room code only? (Drives auth, stats persistence and privacy for minors.)
- Real-time transport: hosting target (long-lived WebSocket/SSE server vs. serverless) is undecided and needs an ADR before any live-race card.
- Text sources: curated passages per language and age band, or teacher-supplied text?
- Privacy: students are 12-17; data retention and consent rules for stored statistics.
