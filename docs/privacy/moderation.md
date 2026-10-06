# Moderation procedure

How Fifth Copy handles offensive usernames and avatars, teacher removals, anti-cheat flagged races and appeals.
Card #91 (epic #29). Requirements: R1, R70, R158, R161, R162, R202, R203. Spec 5.4, 12.2, 12.3, 16.3.

The rules players see are the conduct rules in `src/features/privacy/content/terms.{fr,en}.ts`, shown on
`/privacy#rules` (#80) and linked from sign-up. This file is the operator's side of those rules. When one changes,
check the other in the same PR.

This procedure was written by the project, not by a lawyer. It is not legal advice. The points that need a
qualified person are listed in [Needs qualified review](#needs-qualified-review).

## Principles

- **Users are minors** (12 to 17, R1). Every step collects as little as possible and never asks a student for an
  email address or any new personal information (ADR 0009, `docs/privacy/responsible.md`).
- **No chat** (R162). The only things another player can see are a username, an avatar (lobby members only) and
  race behaviour. Moderation covers exactly those three.
- **Fail safe.** When in doubt, hide first (default portrait, generated name, race excluded from stats), decide
  after. Hiding is reversible; a student's picture shown to a class is not.
- **A flag is not proof.** Filters and anti-cheat checks produce false positives. A person decides any consequence
  beyond hiding.
- **Proportionate.** A first, minor problem gets a correction, not a sanction (ladder below).
- **School first for behaviour.** What happens in the classroom is the school's business under its own code of
  conduct. Fifth Copy only acts on its own data.

## Who decides

| Role | Who | Can do |
|---|---|---|
| Decision owner | The operator: Jimmy Razafindretsa, person in charge of personal information (`docs/privacy/responsible.md`) | Rename, delete avatars, clear or confirm race flags, delete accounts, answer appeals |
| Teacher (race host) | Whoever hosts the lobby | Remove a player from their lobby (spec 5.4, R70); stop inviting them; forward reports and appeals |
| Automatic filters | Username filter (R161), avatar check (ADR 0015, #64), anti-cheat (ADR 0007, spec 16.3) | Block a name at entry, hold or refuse a picture, flag a race. Never sanction |
| Student | Any player | Report to their teacher; appeal through their teacher or school office |

The operator is one person. When a report or appeal concerns the operator's own account, or the operator knows the
student personally, the operator says so to the teacher or school and asks them to confirm the decision.

## Contact route

Students never contact the operator directly. They go through their teacher or their school office, which forwards
to the contact address published on `/privacy` (`docs/privacy/responsible.md`). Players in a public Quick race who
have no teacher involved use a parent or guardian the same way, or simply leave the lobby.

A report or appeal needs only: the username as shown, the lobby code or the date and time of the race, and what is
wrong. No screenshots of other personal information, no real names.

## Response times

Targets, counted from the moment the operator receives the message. They are kept in school days because the
operator is a student; urgent cases are the exception.

| Case | Hide or act | Decision | Answer to whoever reported |
|---|---|---|---|
| Urgent: threat, sexual content, a minor in danger | Within 24 hours | Within 24 hours | Same day as the decision |
| Reported username or avatar | Within 2 school days | Within 5 school days | With the decision |
| Avatar held for review (`PENDING`) | Already hidden | Within 5 school days | Shown in the app (#64) |
| Flagged race, review requested | Already excluded | Within 10 school days, and always before the 30-day keystroke purge | With the decision |
| Appeal | Unchanged while pending | Within 30 days | With the decision |

If a deadline is missed, the content stays hidden: the default portrait stays, the race stays excluded. Nothing
offensive becomes visible because nobody looked.

## Usernames

**Prevention.** Sign-up and rename pass the French and English profanity filter (R161). Guests get a generated
typist name from `src/features/identity/guest/words.ts` (bible 2), so guests cannot pick an offensive name. The filter
misses creative spellings; reports cover the rest.

**In the room.** A student who sees an offensive name tells the teacher. The teacher removes that player from the
lobby (see [Teacher removal](#teacher-removal)) and forwards the username and lobby code to the operator.

**Operator steps.**
1. Find the account by username (read only, after `scripts/db-guard.sh`).
2. Decide: is the name against the conduct rules (`usernames` section)?
3. Not against the rules: no change; tell the teacher why.
4. Against the rules, first time: **rename** to a generated typist name (same generator as guests). Stats and history
   stay; the student picks a new acceptable name at the next sign-in. Add the missed word or spelling to the filter
   list in a normal PR.
5. Serious (threat, hate, sexual, names a real person to hurt them) or repeated after a rename: **delete** the
   account with the operator deletion script (`scripts/delete-user.ts <username|id> --yes`, card #83, now part of
   #81), after telling the teacher or school.

There is no rename script yet. Until one exists, the operator renames with a single audited database update after
`scripts/db-guard.sh` and records it in the moderation log (follow-up card #528).

## Avatars

**What is refused.** The `avatars` section of the conduct rules: nudity or sexual content, violence or weapons,
drugs, hate symbols, a photo of another person without their permission, visible personal details (name, address,
school ID). A photo of the student's own face is allowed but discouraged.

**Pipeline** (cards #62 and #64, ADR 0015). Every uploaded picture, and every picture imported from GitHub or
Discord, is re-encoded, then checked by a local heuristic. No picture leaves the server for checking.
- `approve`: shown to lobby members.
- `flag`: status `PENDING`. Files are kept, and **everyone, including the owner, sees the default portrait**. The
  owner sees "your picture is being reviewed".
- `reject`: files deleted, the previous approved picture stays, the owner sees the rejection message with the appeal
  path.

**Review of `PENDING` pictures.** The operator reviews them with `scripts/avatar-review.ts <userId> approve|reject`
(#64), which runs `scripts/db-guard.sh` first. A teacher can ask for a review of a picture in their class through
the contact route but does not see `PENDING` pictures. Delay: see [Response times](#response-times). The operator
looks at the picture only to decide, does not copy it, and records only the decision.

**Reported approved picture.** A teacher forwards the username and lobby code. The operator looks at it and, if it
breaks the rules, rejects it with the same script: files are deleted and the default portrait shows. Urgent content
is rejected first and reviewed after.

**Appeal path.** The rejection message tells the student to ask their teacher or school office to contact the person
in charge (see [Appeals](#appeals)). An upheld appeal means the student uploads the picture again and the operator
approves it; rejected files are not kept, so nothing is restored automatically.

## Teacher removal

The host can remove a player from the lobby before the race starts (spec 5.4, R70, `host:kick`). This is the first
and fastest tool, and it needs nobody else.

- Effect: the player leaves that lobby only. Their account, stats and other lobbies are unchanged.
- Private lobbies: only the host invites (single-use links, room code), so not re-inviting the player is enough.
- The teacher does not need to justify a removal to the operator. If the reason is a username or avatar, the teacher
  also forwards it so it is fixed for every class.
- Classroom behaviour behind the removal is handled by the school under its own code of conduct.

## Flagged races

**Automatic part** (spec 16.3, R202, R203, ARCHITECTURE 7.7). The race server checks a WPM cap, inhuman regularity
and the keystroke sequence. A flagged result is marked `suspicious`: it shows on the podium with an "under review"
docket and is **excluded from stats, bests and leaderboards**. Nothing else happens automatically.

**Review.** A flagged race is reviewed only when the student (through the teacher) or the teacher asks, or when the
operator sees the same account flagged repeatedly. The operator looks at the keystroke trace, which exists for 30
days only (ARCHITECTURE 9.4). After that, the flag stays and cannot be cleared.

**Outcomes.**
- **Cleared**: a false positive (a very fast or very regular typist). The result counts again in stats. The
  operator notes the pattern so the thresholds can be tuned in a normal PR.
- **Confirmed**: the result stays excluded. A first confirmed case gets nothing more. Repeated confirmed cases follow
  the ladder below.

There is no tool to clear a flag yet. Until the stats cards add one, clearing is a single audited database update
after `scripts/db-guard.sh`, recorded in the moderation log.

## Consequences ladder

| Step | When | What |
|---|---|---|
| 0 | Any problem in a lobby | Teacher removes the player from that lobby |
| 1 | First minor problem | Correction: rename, picture removed, race excluded |
| 2 | Same problem again after a correction | Correction, and the teacher or school is told |
| 3 | Serious content, or a third repeat | Account deleted with `scripts/delete-user.ts`, teacher or school told first |

Urgent content (threats, sexual content, a minor in danger) skips straight to hiding it, then step 3 if the account
is responsible.

## Urgent cases: safety of a minor

If a username, a picture or a report suggests that a young person is in danger or being abused:
1. Hide or delete the content right away.
2. Tell the teacher or school the same day. Schools have their own procedure and staff for this.
3. The operator does not investigate, contact the student or keep a copy of the content.
4. Anyone who has reasonable grounds to believe a minor's security or development is in danger can, and in some
   cases must, report it to the Director of Youth Protection (DPJ) of their region. Immediate danger: 911.
5. Sexual images of a minor are never copied, forwarded or kept, even as evidence. Report them to the police or to
   Cybertip.ca, then delete them.

## Moderation log

The operator keeps a private log outside the app with: date, account id (not the username), case type, decision,
reason code, appeal outcome. No pictures, no screenshots, no real names. Each entry is deleted 12 months after the
decision or when the account is deleted, whichever comes first. This log is personal information about minors: it
must be added to the data inventory and retention table (#71) before launch.

## Appeals

Anyone affected by a decision (rename, picture refused, race not cleared, removal reported, account deleted) can ask
for another look.
1. The student asks their teacher or school office, who sends the operator the username, the decision and why it is
   wrong.
2. The operator looks again at everything available, including any new information.
3. When the operator made the first decision alone and the case is not obvious, the operator asks the teacher or
   school for their view before deciding.
4. The answer goes back the same way within 30 days, with a short reason.
5. The appeal decision is final in the app. It does not limit any right the student or their parents have under the
   law, including a complaint to the Commission d'accès à l'information for personal-information matters.

A deleted account cannot be restored, so before step 3 of the ladder the teacher or school is told, which gives them a
chance to object first.

## Needs qualified review

Open items for a qualified person (lawyer, the cégep's privacy officer, or both) before the classroom pilot (#432).
These texts apply the project's best reading; they are not legal advice and must not be presented as such.

1. **Limits of responsibility** (conduct rules, `service` section). Québec law limits what an exclusion clause can do
   (for example Civil Code art. 1474; the Consumer Protection Act if it applies to a free service). The text says "as
   far as the law allows" and "nothing here takes away rights the law gives you"; check that this is enough and
   correct.
2. **Minors and consent.** Users are 12 to 17. Check whether the conduct rules can bind them as terms of use, whether
   a parent or the school must agree for users under 14 (Law 25 s. 4.1 for personal information), and whether the
   school's use in class changes that.
3. **Moderation log.** Retention, content and purpose of the log above under Law 25; add it to the inventory (#71).
4. **Youth protection.** The reporting duty under the Youth Protection Act as it applies to an individual operator
   who is not school staff; the wording of the urgent-case steps.
5. **Who runs the pilot.** Whether the classroom pilot falls under the cégep's or school's own policies (privacy,
   acceptable use), which would change the decision owner (see `docs/privacy/responsible.md`).
6. **Uploaded pictures.** Copyright and image rights of avatars, and whether rejected files may be deleted without
   keeping a copy when an appeal is possible.
