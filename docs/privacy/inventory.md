# Personal information inventory

Every piece of personal information Fifth Copy collects or produces about its users, why it exists, where it lives
and what removes it. Card #71 (epic #29). Requirements: R1, R152, R164. Index: [README](README.md).

Users are students aged 12 to 17. Most of them play as guests: a random typist name and typing statistics tied to a
cookie, nothing that names them. Fifth Copy never asks for an email address, a real name, a birth date or a school
(ADR 0009). Avatars are seen only by the members of a lobby (ADR 0014).

How to read this table:
- **Necessity** answers Law 25 s. 5: collect only what the stated purpose needs. "Needed" means the feature cannot
  work without it; "Optional" means the student chooses to give it.
- **Retention** links to [retention.md](retention.md), the only place where periods are written.
- **Where** names the schema file and `Model.field` (field lists live only in `prisma/schema/*.prisma`), a code path,
  or "outside the app".
- **Status**: "in schema" exists today; "planned #n" is designed in ARCHITECTURE 9.2 and arrives with that card.
- When this table and the schema disagree, the schema is right and this file is fixed in the same PR.
  `scripts/privacy-inventory-check.ts` (`scripts/check.sh privacy`) fails when a Prisma model is missing here.

## Inventory

| Data | Purpose | Necessity (Law 25 s. 5) | Retention | Where | Deleted by | Status |
|---|---|---|---|---|---|---|
| Account id (guest or account) | Link a player's results and settings to one row | Needed: every other row hangs on it | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `User.id` | #81 (delete my data), #86 (inactive guests) | in schema |
| Guest cookie `fc_guest` | Recognise a guest's browser without a password; holds the signed account id only | Needed for guests | [Guest cookie](retention.md#periods) | browser cookie, `src/server/auth/guest-cookie.ts` | #81 clears it; expires on its own | in code |
| Typist name | Public display name in lobbies, races and results | Needed: players must tell desks apart; guests get a generated name | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `User.typistName` | #81, #86 | in schema |
| Username | Sign-in name chosen by students who create an account | Optional: only for students who want an account | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `User.username`, `User.usernameNormalized` | #81 | in schema |
| Password hash | Check the password at sign-in (Argon2id, the password itself is never stored) | Needed for username accounts | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `User.passwordHash` | #81 | in schema |
| Recovery code hash | Let a student without email recover an account | Needed for username accounts (no email, ADR 0009) | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `RecoveryCode` | #81 | planned #486 |
| OAuth provider id | Sign in with GitHub or Discord: provider name, provider account id and login | Optional: only students who choose a provider | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `OAuthAccount` | #81 | planned #486 |
| Session cookie and token version | Keep a signed-in student signed in; the version revokes old sessions | Needed for accounts | [Session cookie](retention.md#periods) | browser cookie (Auth.js JWT, #38), `prisma/schema/identity.prisma` `User.tokenVersion` | sign-out, expiry, #81 | planned #38 (cookie), in schema (version) |
| Avatar file | Picture shown to lobby members; uploaded or imported from GitHub or Discord | Optional | [Avatars](retention.md#periods) | `AVATAR_DIR` private volume (ADR 0014), `prisma/schema/identity.prisma` `User.avatarKey` | #64 (rejected pictures), #81 | in schema |
| Avatar status | Hide a picture until it is approved (`PENDING`, `REJECTED`) | Needed while avatars exist | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `User.avatarStatus` | #81 | in schema |
| Preferences | Language, theme, keyboard layout and other settings | Needed for the settings the student picks | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `Preference`; browser cookies (`src/features/preferences/cookie.ts`) | #81 | planned #486 (table), in code (cookies) |
| Account dates | Know when an account was created and last used, to delete inactive guests | Needed for the guest purge | [Accounts](retention.md#periods) | `prisma/schema/identity.prisma` `User.createdAt`, `User.lastSeenAt` | #81, #86 | in schema |
| Lobby record | Who hosts a lobby, its room code and state | Needed to run a lobby | [Lobbies](retention.md#periods) | `prisma/schema/lobby.prisma` `Lobby.hostUserId`, `Lobby.code` | #143 (expiry sweep), #81 (cascade) | in schema |
| Invite tokens | Single-use links a host sends to join a private lobby | Needed for private lobbies | [Invites](retention.md#periods) | Redis `invite:<token>` (ADR 0008) | TTL, first use | planned #143 |
| Live room state | Who is at which desk, progress and position during a race | Needed to run a race | [Live rooms](retention.md#periods) | Redis room hash, presence and resume keys (ADR 0008) | TTL | in code |
| Race results | Speed, accuracy, rank and time of each finished race, flags for suspicious races | Needed for results, history and stats | [Accounts](retention.md#periods) | `prisma/schema/race.prisma` `Race`, `RaceResult` | #81 | planned #188 |
| Raw keystrokes | Every key and its timing in one race, for per-key stats and anti-cheat review | Needed for 30 days only, then rolled up | [Raw keystrokes](retention.md#periods) | `prisma/schema/race.prisma` `RaceKeystrokes` | #315 (purge), #81 | planned #188 |
| Daily character stats | Hits, errors and average time per key per day (heatmap, tips) | Needed for the stats page | [Accounts](retention.md#periods) | `prisma/schema/stats.prisma` `CharStatDaily` | #81 | planned #312 |
| Personal bests | Best speed per language and race type | Needed for the stats page | [Accounts](retention.md#periods) | `prisma/schema/stats.prisma` `PersonalBest` | #81 | planned #321 |
| Achievements | Medals earned and when | Needed for the medals feature | [Accounts](retention.md#periods) | `prisma/schema/stats.prisma` `Achievement` | #81 | planned #333 |
| Job records | Background jobs may carry an account id as an argument (for example "roll up this player's day") | Needed while a job runs | [Job records](retention.md#periods) | `prisma/schema/jobs.prisma` `JobRun` (ADR 0011) | #81 deletion step, job cleanup | planned (ADR 0011) |
| Request logs and IP addresses | Find errors and abuse; the proxy and the apps see the IP address of every request | Needed for security, kept short | [Logs](retention.md#periods) | Caddy and Docker logs on the server (ADR 0012), `pino` with PII redaction | log rotation, #403, #420 | planned #403 |
| Rate-limit counters | Slow down password guessing and floods; may be keyed by IP address or account | Needed for security | [Rate limits](retention.md#periods) | Redis counters (ADR 0008) | TTL | planned #207 |
| Backups | Restore the service after a failure; contain a copy of every database row and avatar file | Needed to avoid losing everyone's data | [Backups](retention.md#periods) | off-box bucket (ADR 0012), see [backup-retention.md](backup-retention.md) | rotation, #403, #81 | planned #403 |
| Moderation log | Record moderation decisions: date, account id, case type, decision, appeal outcome | Needed to apply rules fairly and answer appeals | [Moderation log](retention.md#periods) | outside the app: kept privately by the operator ([moderation.md](moderation.md)) | the operator, by hand | in use when moderation starts |
| Requests to the person in charge | Access, correction or deletion requests forwarded by a teacher or school | Needed to answer within 30 days | [Requests](retention.md#periods) | outside the app: the person in charge's mailbox ([responsible.md](responsible.md)) | the person in charge, by hand | in use at launch |

Nothing in this table is sold, shared for advertising or sent to an analytics service. GitHub and Discord receive only
what the student's own sign-in sends them; see [pia.md](pia.md) for every flow.

## Non-personal models

Prisma models that hold no personal information. A model moves to the table above as soon as it gets a field that
points to a person.

- `Text`: race texts and passages with language, source and licence (#346). Texts come from public-domain sources and
  teachers; they record a source, not the account that added them. If a teacher's name is ever stored as an author,
  add a row above.
