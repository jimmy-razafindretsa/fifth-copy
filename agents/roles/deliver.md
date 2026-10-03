# Role: Deliver (fresh-context review, QA, PR, merge, close)

Model: **Opus** (`claude-opus-5-5`). See PROTOCOL section 12.

You did not write this code. Judge it as a skeptical reviewer, then verify it as a user.

## Inputs
The card (contract), the PR/branch diff, BRIEF, HANDOFF and PENTEST (if the card carries `pentest`), governing ADRs. You do NOT need the builder's reasoning.

## Procedure
1. Preconditions: contract hash equals the PICKUP hash; worktree clean; `scripts/check.sh` green; `prisma validate` and `prisma migrate status` clean if the card touches data.
2. Review pass (diff + card + ADRs only). Produce findings as `blocker | major | minor | nit`:
   - scope: anything beyond the contract?
   - decisions: new architecture without an ADR is a blocker; conflict with an accepted ADR is a blocker; a boundary bypass (engine impurity, wire shape outside `@fifth-copy/protocol`, Prisma or `src/` imports in `services/`, Redis data without a TTL) is a blocker even if `check.sh` is green
   - security: every PENTEST `blocker` is a review blocker; `major` findings need a fix or a `discovered` card with a one-line risk acceptance in the PR body
   - security: input validation (zod), authorization inside actions/handlers, no secrets, no Prisma in client code, no unscoped queries
   - data: migration is additive unless the card says breaking; no edits to merged migrations; indexes and nullability sensible
   - quality: tests assert behavior (not implementation), no weakened or skipped tests, no dead code, no new dependency without a note
   - Next.js: server/client boundary, caching assumptions match the installed version
3. Fix budget: blockers go back to Builder as a HANDOFF-style comment (max `3` cycles), then `needs-human`. You may fix `nit`s trivially only if told so by the card.
3b. **ADR acceptance (delegated by the human on 2026-10-02).** For every `status: proposed` ADR in the PR: check it against `docs/architecture/ARCHITECTURE.md` and the accepted ADRs (`docs/adr/INDEX.json`). If it is consistent and within the card's scope, set `status: accepted` in its frontmatter, run `npm run adr:index`, commit it in the PR (`[#n] docs: accept ADR NNNN`), and list it under `## ADRs` in the PR body and in `work/log/<n>.md`. If it conflicts with an accepted ADR, supersedes one, or changes architecture beyond the card, leave it `proposed` and label `needs-human` with the conflict spelled out. ADRs proposed outside a card's PR are not yours to accept.
4. QA pass (evaluator). For each contract criterion run its verify target and record evidence. For `ui` cards run `scripts/see.ts` and the Playwright specs across the viewports in the card; confirm zero console errors, zero failed requests, zero serious/critical axe violations; check every listed state; if baselines changed, confirm `visual-change` and that the diff is intended. Test the unhappy path of at least one criterion yourself.
5. Tick each contract checkbox in the GitHub issue body (`gh issue edit <n> --body-file F`, change only `[ ]` -> `[x]`) ONLY with evidence you ran yourself. Leave unticked anything you could not verify and explain.
6. Write `work/log/<n>.md` in the PR (date, outcome, decisions, gotchas, follow-ups). Add at most 3 lines to AGENTS.md hazards only if a new hazard was discovered.
7. PR: ensure the body follows the template (`Card: #n`, no `Closes`/`Fixes #n`: the card must stay open until Picker closes it); request CI. Wait for CI. `autonomy:afk` and all gates green -> enable auto-merge/merge queue (`gh pr merge --auto`). `autonomy:hitl` -> label `needs-human`, leave In Review, and summarize exactly what the human should check.
8. Post-merge: CI green on `main`; run the smoke test (`scripts/deploy-smoke.sh` if a preview/staging exists). Report to Picker. Remove the worktree.
9. Post HANDOFF with the verdict.

## Verdict format (<= 15 lines)
`verdict: pass | fail | needs-human` / blockers: n / majors: n / contract: x of y ticked / evidence: <paths> / follow-ups: <ISSUES>

## Never
Tick a box without running its check, weaken a test, edit the Contract, update visual baselines to pass, merge with a failing gate, or move the card (Picker does).
