---
id: "0016"
title: Shown WPM is clean WPM; text-changing bonuses stay fair through per-desk overlays, effective-text finish order and reproducible traces
status: accepted
category: architecture
scope: ["packages/engine/src/bonus/**", "packages/engine/src/text/overlay.ts", "packages/engine/src/scoring/**", "services/race-server/src/rooms/**", "services/race-server/src/persist/results.ts", "src/features/results/**", "src/features/stats/**"]
supersedes: []
rule: Nixies, podium, ranking columns, personal bests and ranks show and use clean WPM (base-text characters only); bonus-adjusted WPM is stored and shown only on the personal stats card; finish order and progress are by effective-text completion; bonus effects only change text beyond a desk's high-water mark, and every trace is analysed against the desk's effective text.
---

# 0016. Shown WPM is clean WPM; text-changing bonuses stay fair through per-desk overlays, effective-text finish order and reproducible traces

## Context
Spec 10 adds catch-up bonuses (card #190, plan F4.14 and F4.16): Extra Paperwork appends words to the leader's text, Exemption removes words from the sender's own remaining text, Smoke Break blurs the desks ahead. ADR 0007 already fixes the model: bonuses never edit the base text, each desk types `effectiveText(base, overlay)`, clean WPM counts the base text only, adjusted WPM the effective text, and finish order follows effective-text completion. It leaves open which WPM is shown, how the numbers feed bests and ranks (epic #311), and what keeps a text-changing bonus from making an honest trace look forged to the anti-cheat replay (ADR 0007 point "server at race end, worker re-analysis"). ARCHITECTURE 7.6 and its open question 14 (bots and bonuses) are the other inputs.

## Decision
1. **Shown WPM = clean WPM.** The nixie counters, the podium and the ranking columns show clean WPM. Personal bests and ranks (epic #311) use clean WPM. Bonus-adjusted WPM is stored on every result (`RaceResult.adjustedWpm`) and shown only on the personal stats card. Extra Paperwork can therefore make the leader finish later without lowering their shown WPM; Exemption raises the beneficiary's progress, never their WPM.
2. **Finish order and progress = effective-text completion** (ADR 0007): `progress = cursor / effective length` per desk on the race server (live ranking, race end, stored result).
3. **Rules, in the engine** (`packages/engine/src/bonus/rules.ts`, one `BONUS_RULES` row per kind): `rankPct = (rank - 1) / (N - 1)` over the live order; no card for the leader nor when `N < 3`; thresholds inclusive: Smoke Break `>= 0.75`, Exemption `>= 0.67`, Extra Paperwork `>= 0.5`; one card held at a time; a play at most once per `COOLDOWN_MS = 15 000` per desk, all kinds together; `EXTRA_WORDS = 5` words drawn from the base text with the injected rng; `EXEMPT_WORDS = 5`; `BLUR_MS = 5 000`. Spec 10 values or defaults for the teacher to tune.
4. **Targets are the engine's, never the client's**: typing desks only. Extra Paperwork hits the best-ranked typing desk ahead of the sender; Smoke Break every typing desk ahead; Exemption the sender. Repeat immunity applies to the hostile kinds (Extra Paperwork, Smoke Break): a desk last hit by kind K is not hit by K again until another hostile kind hits it; Exemption is not a hit and neither triggers nor resets immunity. Immune targets are dropped; no target left is a refusal (`rejected { no-bonus }`, card kept). An overlay is bounded by `MAX_OVERLAY_WORDS` (Extra Paperwork is refused past it).
5. **Reproducible traces.** Exemption removes only base words after the word at the desk's **high-water mark** (`reach`, the furthest cursor it ever had, backspaces included), keeping the word that mark sits on (or the next word when it sits on a separator). Extra Paperwork only appends. So no effect changes a character any keystroke ever reached, the effective text stays longer than the mark, and replaying the whole trace on the final effective text reproduces the live state; an exemption never finishes a desk by itself. The race server analyses each trace against the desk's effective text (`buildResults`); analysing against the base would flag an overlaid, honest desk `unreproducible`.
6. **Ledger.** `bonusesSent` counts plays; `bonusesReceived` counts hits from another desk (an Exemption on oneself is sent, not received); `bonusLog` holds one `{ t, kind, from, to }` per (sender, target) pair the desk is part of, at most 1 024 entries.
7. **Bots** are dealt cards and play them automatically after holding one for 3 s (open question 14: "yes until the teacher says otherwise").
8. **Blur travels as `bonus-hit.blurUntil`** (ms since GO, protocol v4 #557), not as a flag in the snapshot: ARCHITECTURE 7.6 says "a timed `blur` flag in the target's snapshot"; the wire contract chose the event, and this ADR records that as the decision (no protocol change).

## Consequences
- The stored result already has the columns (#188); #190 fills them. Bests, ranks and the podium read `cleanWpm`; only the stats card reads `adjustedWpm`.
- Trace bounds follow the effective text: the race server caps a desk's trace at `traceCapOf(effective length)`; the web, which does not know the overlay yet, accepts up to `traceCapOf(base) + TRACE_KEYS_PER_CHAR * MAX_OVERLAY_WORDS * (MAX_EXTRA_WORD_LENGTH + 1)` keystrokes (`maxStoredTraceKeys`, `src/features/results/actions/persist-results.ts`), so an honest overlaid desk is never refused; #623 can tighten it to the stored overlay.
- Smoke Break's blur is rendered by the client only (#236): the server records `blurUntil` and sends it in `bonus-hit`, but it does not change what the target may type or how its keystrokes are scored.
- The stored result carries no overlay yet: worker re-analysis and the per-race WPM series (#302) need it to replay against the effective text; card #623 adds it (protocol + Prisma, additive).
- Snapshots carry each desk's cursor but not its effective length, so a client's progress bars of rivals drift after a bonus while the ranks stay authoritative; the HUD card (#236) reconciles from `bonus-hit` and `welcome.overlay`.
- The bonus log (`ledger.log`) stays in process like the trace and is never mirrored to the desks hash; the counters, overlay, held card, cooldown, immunity and blur are (ADR 0008, room TTL). A running room is voided on restart (ADR 0008), so the log is never needed for recovery.
- A new bonus is one `BonusKind` member, one `BONUS_RULES` row and one effect function; the race server step (`rooms/bonus-step.ts`) only orchestrates.

## Alternatives considered
- **Show adjusted WPM**: rewards receiving Exemptions and punishes the leader for being sabotaged; makes bests depend on luck. Rejected.
- **Show both everywhere**: two numbers on nixies and the podium confuse a 12-year-old audience. Rejected; the stats card shows both.
- **Remove words from the cursor word or right after the cursor**: simpler, but a desk that typed ahead and backspaced would replay to a different state (unreproducible flag on an honest desk) or finish early. Rejected for the high-water mark rule.
- **Let the client name a target**: opens forged targeting; the engine chooses from the live order instead.
