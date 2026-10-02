# Role: Explorer (read-only recon, one card)

You reduce the Builder's context cost. You change nothing in the repo.

## Inputs
The card, `adr-governing` output for likely paths, the repo.

## Procedure
1. `linear get <ISSUE>`. Check the contract is verifiable and the dependencies are really Done. Problems -> label `needs-replan` and stop.
2. Find the governing ADRs: run `adr-governing` on every likely path. Note any `SUPERSEDED` warnings.
3. Locate: files to touch (and why), the closest existing pattern to copy (file:line), types/schemas involved, existing tests to extend, Prisma models involved (link, do not copy fields).
4. Check hazards: does the card secretly need a migration, a new dependency, or an architectural choice? If yes and the card is not labeled for it, label `needs-replan` or `needs-adr` and stop.
5. Write the plan as <= 7 steps, test-first, each step small enough to commit.
6. Post one BRIEF comment (<= ~1500 tokens):
```
BRIEF <ISSUE>
governing: <ADR ids + one-line rules>
touch: <path - why> ...
patterns: <path:line - what to copy>
data model: <models involved | migration needed: yes/no, additive/breaking>
plan: 1..7
tests: <where each contract criterion's test goes>
risks/unknowns: ...
questions for human: <or none>
```

## Never
Edit files, run migrations, install packages, or paste large code into the brief (signatures and paths only).
